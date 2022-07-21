/*
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import BanList, { ChangeType, ListRuleChange } from "./PolicyList"
import * as crypto from "crypto";
import { LogService } from "matrix-bot-sdk";
import { EntityType, ListRule } from "./ListRule";
import PolicyList from "./PolicyList";

export const USER_MAY_INVITE = 'user_may_invite';
export const CHECK_EVENT_FOR_SPAM = 'check_event_for_spam';

/**
 * Rules in the RuleServer format that have been produced from a single event.
 */
class EventRules {
    constructor(
        readonly eventId: string,
        readonly roomId: string,
        readonly ruleServerRules: RuleServerRule[],
        // The token associated with when the event rules were created.
        readonly token: number
    ) {
    }
}

/**
 * A description of a property that should be checked as part of a RuleServerRule.
 */
interface Checks {
    property: string;
}

/**
 * A Rule served by the rule server.
 */
interface RuleServerRule {
    // A unique identifier for this rule.
    readonly id: string
    // A description of a property that should be checked.
    readonly checks: Checks
}

/**
 * The RuleServer is an experimental server that is used to propogate the rules of the watched policy rooms (BanLists) to
 * homeservers (or e.g. synapse modules).
 * This is done using an experimental format that is heavily based on the "Spam Checker Callbacks" made available to
 * synapse modules https://matrix-org.github.io/synapse/latest/modules/spam_checker_callbacks.html.
 *
 */
export default class RuleServer {
    // Each token is an index for a row of this two dimensional array.
    // Each row represents the rules that were added during the lifetime of that token.
    private ruleStartsByToken: EventRules[][] = [[]];

    // Each row, indexed by a token, represents the rules that were stopped during the lifetime of that token.
    private ruleStopsByToken: string[][] = [[]];

    // We use this to quickly lookup if we have stored a policy without scanning rulesByToken.
    // First key is the room id and the second is the event id.
    private rulesByEvent: Map<string, Map<string, EventRules>> = new Map();

    // A unique identifier for this server instance that is given to each response so we can tell if the token
    // was issued by this server or not. This is important for when Mjolnir has been restarted
    // but the client consuming the rules hasn't been
    // and we need to tell the client we have rebuilt all of the rules (via `reset` in the response).
    private readonly serverId: string = crypto.randomUUID();

    // Represents the current instant in which rules can started and/or stopped.
    // Should always be incremented before adding rules. See `nextToken`.
    private currentToken = 0;

    private readonly banListUpdateListener = this.update.bind(this);

    /**
     * The token is used to separate EventRules from each other based on when they were added.
     * The lower the token, the longer a rule has been tracked for (relative to other rules in this RuleServer).
     * The token is incremented before adding new rules to be served.
     */
    private nextToken(): void {
        this.currentToken += 1;
        this.ruleStartsByToken.push([]);
        this.ruleStopsByToken.push([]);
    }

    /**
     * Get a combination of the serverId and currentToken to give to the client.
     */
    private get since(): string {
        return `${this.serverId}::${this.currentToken}`;
    }

    /**
     * Get the `EventRules` object for a Matrix event.
     * @param roomId The room the event came from.
     * @param eventId The id of the event.
     * @returns The `EventRules` object describing which rules have been created based on the policy the event represents
     * or `undefined` if there are no `EventRules` associated with the event.
     */
    private getEventRules(roomId: string, eventId: string): EventRules | undefined {
        return this.rulesByEvent.get(roomId)?.get(eventId);
    }

    /**
     * Add the EventRule to be served by the rule server at the current token.
     * @param eventRules Add rules for an associated policy room event. (e.g. m.policy.rule.user).
     * @throws If there are already rules associated with the event specified in `eventRules.eventId`.
     */
    private addEventRules(eventRules: EventRules): void {
        const { roomId, eventId, token } = eventRules;
        if (this.rulesByEvent.get(roomId)?.has(eventId)) {
            throw new TypeError(`There is already an entry in the RuleServer for rules created from the event ${eventId}.`);
        }
        const roomTable = this.rulesByEvent.get(roomId);
        if (roomTable) {
            roomTable.set(eventId, eventRules);
        } else {
            this.rulesByEvent.set(roomId, new Map().set(eventId, eventRules));
        }
        this.ruleStartsByToken[token].push(eventRules);
    }

    /**
     * Stop serving the rules from this policy rule.
     * @param eventRules The EventRules to stop serving from the rule server.
     */
    private stopEventRules(eventRules: EventRules): void {
        const { eventId, roomId, token } = eventRules;
        this.rulesByEvent.get(roomId)?.delete(eventId);
        // We expect that each row of `rulesByEvent` list of eventRules (represented by 1 row in `rulesByEvent`) to be relatively small (1-5)
        // as it can only contain eventRules added during the instant of time represented by one token.
        const index = this.ruleStartsByToken[token].indexOf(eventRules);
        if (index > -1) {
            this.ruleStartsByToken[token].splice(index, 1);
        }
        eventRules.ruleServerRules.map(rule => this.ruleStopsByToken[this.currentToken].push(rule.id));
    }

    /**
     * Update the rule server to reflect a ListRule change.
     * @param change A ListRuleChange sourced from a BanList.
     */
    private applyRuleChange(change: ListRuleChange): void {
        if (change.changeType === ChangeType.Added) {
            const eventRules = new EventRules(change.event.event_id, change.event.room_id, toRuleServerFormat(change.rule), this.currentToken);
            this.addEventRules(eventRules);
        } else if (change.changeType === ChangeType.Modified) {
            const entry: EventRules | undefined = this.getEventRules(change.event.roomId, change.previousState.event_id);
            if (entry === undefined) {
                LogService.error('RuleServer', `Could not find the rules for the previous modified state ${change.event['state_type']} ${change.event['state_key']} ${change.previousState?.event_id}`);
                return;
            }
            this.stopEventRules(entry);
            const eventRules = new EventRules(change.event.event_id, change.event.room_id, toRuleServerFormat(change.rule), this.currentToken);
            this.addEventRules(eventRules);
        } else if (change.changeType === ChangeType.Removed) {
            // 1) When the change is a redaction, the original version of the event will be available to us in `change.previousState`.
            // 2) When an event has been "soft redacted" (ie we have a new event with the same state type and state_key with no content),
            // the events in the `previousState` and `event` slots of `change` will be distinct events.
            // In either case (of redaction or "soft redaction") we can use `previousState` to get the right event id to stop.
            const entry: EventRules | undefined = this.getEventRules(change.event.room_id, change.previousState.event_id);
            if (entry === undefined) {
                LogService.error('RuleServer', `Could not find the rules for the previous modified state ${change.event['state_type']} ${change.event['state_key']} ${change.previousState?.event_id}`);
                return;
            }
            this.stopEventRules(entry);
        }
    }

    /**
     * Watch the ban list for changes and serve its policies as rules.
     * You will almost always want to call this before calling `updateList` on the BanList for the first time,
     * as we won't be able to serve rules that have already been interned in the BanList.
     * @param banList a BanList to watch for rule changes with.
     */
    public watch(banList: PolicyList): void {
        banList.on('PolicyList.update', this.banListUpdateListener);
    }

    /**
     * Remove all of the rules that have been created from the policies in this banList.
     * @param banList The BanList to unwatch.
     */
    public unwatch(banList: PolicyList): void {
        banList.removeListener('PolicyList.update', this.banListUpdateListener);
        const listRules = this.rulesByEvent.get(banList.roomId);
        this.nextToken();
        if (listRules) {
            for (const rule of listRules.values()) {
                this.stopEventRules(rule);
            }
        }
    }

    /**
     * Process the changes that have been made to a BanList.
     * This will ususally be called as a callback from `BanList.onChange`.
     * @param banList The BanList that the changes happened in.
     * @param changes An array of ListRuleChanges.
     */
    private update(banList: BanList, changes: ListRuleChange[]) {
        if (changes.length > 0) {
            this.nextToken();
            changes.forEach(this.applyRuleChange, this);
        }
    }

    /**
     * Get all of the new rules since the token.
     * @param sinceToken A token that has previously been issued by this server.
     * @returns An object with the rules that have been started and stopped since the token and a new token to poll for more rules with.
     */
    public getUpdates(sinceToken: string | null): { start: RuleServerRule[], stop: string[], reset?: boolean, since: string } {
        const updatesSince = <T = EventRules | string>(token: number | null, policyStore: T[][]): T[] => {
            if (token === null) {
                // The client is requesting for the first time, we will give them everything.
                return policyStore.flat();
            } else if (token === this.currentToken) {
                // There will be no new rules to give this client, they're up to date.
                return [];
            } else {
                return policyStore.slice(token).flat();
            }
        }
        const [serverId, since] = sinceToken ? sinceToken.split('::') : [null, null];
        const parsedSince: number | null = since ? parseInt(since, 10) : null;
        if (serverId && serverId !== this.serverId) {
            // The server has restarted, but the client has not and still has rules we can no longer account for.
            // So we have to resend them everything.
            return {
                start: updatesSince(null, this.ruleStartsByToken).map((e: EventRules) => e.ruleServerRules).flat(),
                stop: updatesSince(null, this.ruleStopsByToken),
                since: this.since,
                reset: true
            }
        } else {
            // We will bring the client up to date on the rules.
            return {
                start: updatesSince(parsedSince, this.ruleStartsByToken).map((e: EventRules) => e.ruleServerRules).flat(),
                stop: updatesSince(parsedSince, this.ruleStopsByToken),
                since: this.since,
            }
        }
    }
}

/**
* Convert a ListRule into the format that can be served by the rule server.
* @param policyRule A ListRule to convert.
* @returns An array of rules that can be served from the rule server.
*/
function toRuleServerFormat(policyRule: ListRule): RuleServerRule[] {
    function makeLiteral(literal: string) {
        return { literal }
    }

    function makeGlob(glob: string) {
        return { glob }
    }

    function makeServerGlob(server: string) {
        return { glob: `:${server}` }
    }

    function makeRule(checks: Checks) {
        return {
            id: crypto.randomUUID(),
            checks: checks
        }
    }

    if (policyRule.kind === EntityType.RULE_USER) {
        // Block any messages or invites from being sent by a matching local user
        // Block any messages or invitations from being received that were sent by a matching remote user.
        return [{
            property: USER_MAY_INVITE,
            user_id: [makeGlob(policyRule.entity)]
        },
        {
            property: CHECK_EVENT_FOR_SPAM,
            sender: [makeGlob(policyRule.entity)]
        }].map(makeRule)
    } else if (policyRule.kind === EntityType.RULE_ROOM) {
        // Block any messages being sent or received in the room, stop invitations being sent to the room and
        // stop anyone receiving invitations from the room.
        return [{
            property: USER_MAY_INVITE,
            'room_id': [makeLiteral(policyRule.entity)]
        },
        {
            property: CHECK_EVENT_FOR_SPAM,
            'room_id': [makeLiteral(policyRule.entity)]
        }].map(makeRule)
    } else if (policyRule.kind === EntityType.RULE_SERVER) {
        // Block any invitations from the server or any new messages from the server.
        return [{
            property: USER_MAY_INVITE,
            user_id: [makeServerGlob(policyRule.entity)]
        },
        {
            property: CHECK_EVENT_FOR_SPAM,
            sender: [makeServerGlob(policyRule.entity)]
        }].map(makeRule)
    } else {
        LogService.info('RuleServer', `Ignoring unsupported policy rule type ${policyRule.kind}`);
        return []
    }
}
