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

import { extractRequestError, LogService, MatrixClient } from "matrix-bot-sdk";
import { EventEmitter } from "events";
import { ListRule } from "./ListRule";

export const RULE_USER = "m.policy.rule.user";
export const RULE_ROOM = "m.policy.rule.room";
export const RULE_SERVER = "m.policy.rule.server";

// README! The order here matters for determining whether a type is obsolete, most recent should be first.
// These are the current and historical types for each type of rule which were used while MSC2313 was being developed
// and were left as an artifact for some time afterwards.
// Most rules (as of writing) will have the prefix `m.room.rule.*` as this has been in use for roughly 2 years.
export const USER_RULE_TYPES = [RULE_USER, "m.room.rule.user", "org.matrix.mjolnir.rule.user"];
export const ROOM_RULE_TYPES = [RULE_ROOM, "m.room.rule.room", "org.matrix.mjolnir.rule.room"];
export const SERVER_RULE_TYPES = [RULE_SERVER, "m.room.rule.server", "org.matrix.mjolnir.rule.server"];
export const ALL_RULE_TYPES = [...USER_RULE_TYPES, ...ROOM_RULE_TYPES, ...SERVER_RULE_TYPES];

export const SHORTCODE_EVENT_TYPE = "org.matrix.mjolnir.shortcode";

export function ruleTypeToStable(rule: string, unstable = true): string|null {
    if (USER_RULE_TYPES.includes(rule)) return unstable ? USER_RULE_TYPES[USER_RULE_TYPES.length - 1] : RULE_USER;
    if (ROOM_RULE_TYPES.includes(rule)) return unstable ? ROOM_RULE_TYPES[ROOM_RULE_TYPES.length - 1] : RULE_ROOM;
    if (SERVER_RULE_TYPES.includes(rule)) return unstable ? SERVER_RULE_TYPES[SERVER_RULE_TYPES.length - 1] : RULE_SERVER;
    return null;
}

export enum ChangeType {
    Added    = "ADDED",
    Removed  = "REMOVED",
    Modified = "MODIFIED"
}

export interface ListRuleChange {
    readonly changeType: ChangeType,
    /**
     * State event that caused the change.
     * If the rule was redacted, this will be the redacted version of the event.
     */
    readonly event: any,
    /**
     * The sender that caused the change.
     * The original event sender unless the change is because `event` was redacted. When the change is `event` being redacted
     * this will be the user who caused the redaction.
     */
    readonly sender: string,
    /**
     * The current rule represented by the event.
     * If the rule has been removed, then this will show what the rule was.
     */
    readonly rule: ListRule,
    /**
     * The previous state that has been changed. Only (and always) provided when the change type is `ChangeType.Removed` or `Modified`.
     * This will be a copy of the same event as `event` when a redaction has occurred and this will show its unredacted state.
     */
    readonly previousState?: any,
}

declare interface BanList {
    on(event: 'BanList.update', listener: (list: BanList, changes: ListRuleChange[]) => void): this
    emit(event: 'BanList.update', list: BanList, changes: ListRuleChange[]): boolean
}

/**
 * The BanList caches all of the rules that are active in a policy room so Mjolnir can refer to when applying bans etc.
 * This cannot be used to update events in the modeled room, it is a readonly model of the policy room.
 */
class BanList extends EventEmitter {
    private shortcode: string|null = null;
    // A map of state events indexed first by state type and then state keys.
    private state: Map<string, Map<string, any>> = new Map();

    /**
     * Construct a BanList, does not synchronize with the room.
     * @param roomId The id of the policy room, i.e. a room containing MSC2313 policies.
     * @param roomRef A sharable/clickable matrix URL that refers to the room.
     * @param client A matrix client that is used to read the state of the room when `updateList` is called.
     */
    constructor(public readonly roomId: string, public readonly roomRef, private client: MatrixClient) {
        super();
    }

    /**
     * The code that can be used to refer to this banlist in Mjolnir commands.
     */
    public get listShortcode(): string {
        return this.shortcode || '';
    }

    /**
     * Lookup the current rules cached for the list.
     * @param stateType The event type e.g. m.policy.rule.user.
     * @param stateKey The state key e.g. rule:@bad:matrix.org
     * @returns A state event if present or null.
     */
    private getState(stateType: string, stateKey: string) {
        return this.state.get(stateType)?.get(stateKey);
    }

    /**
     * Store this state event as part of the active room state for this BanList (used to cache rules).
     * The state type should be normalised if it is obsolete e.g. m.room.rule.user should be stored as m.policy.rule.user.
     * @param stateType The event type e.g. m.room.policy.user.
     * @param stateKey The state key e.g. rule:@bad:matrix.org
     * @param event A state event to store.
     */
    private setState(stateType: string, stateKey: string, event: any): void {
        let typeTable = this.state.get(stateType);
        if (typeTable) {
            typeTable.set(stateKey, event);
        } else {
            this.state.set(stateType, new Map().set(stateKey, event));
        }
    }

    /**
     * Return all the active rules of a given kind.
     * @param kind e.g. RULE_SERVER (m.policy.rule.server)
     * @returns The active ListRules for the ban list of that kind.
     */
    private rulesOfKind(kind: string): ListRule[] {
        const rules: ListRule[] = []
        const stateKeyMap = this.state.get(kind);
        if (stateKeyMap) {
            for (const event of stateKeyMap.values()) {
                const rule = event?.unsigned?.rule;
                if (rule && rule.kind === kind) {
                    rules.push(rule);
                }
            }
        }
        return rules;
    }

    public set listShortcode(newShortcode: string) {
        const currentShortcode = this.shortcode;
        this.shortcode = newShortcode;
        this.client.sendStateEvent(this.roomId, SHORTCODE_EVENT_TYPE, '', {shortcode: this.shortcode}).catch(err => {
            LogService.error("BanList", extractRequestError(err));
            if (this.shortcode === newShortcode) this.shortcode = currentShortcode;
        });
    }

    public get serverRules(): ListRule[] {
        return this.rulesOfKind(RULE_SERVER);
    }

    public get userRules(): ListRule[] {
        return this.rulesOfKind(RULE_USER);
    }

    public get roomRules(): ListRule[] {
        return this.rulesOfKind(RULE_ROOM);
    }

    public get allRules(): ListRule[] {
        return [...this.serverRules, ...this.userRules, ...this.roomRules];
    }

    /**
     * Synchronise the model with the room representing the ban list by reading the current state of the room
     * and updating the model to reflect the room.
     * @returns A description of any rules that were added, modified or removed from the list as a result of this update.
     */
    public async updateList(): Promise<ListRuleChange[]> {
        let changes: ListRuleChange[] = [];

        const state = await this.client.getRoomState(this.roomId);
        for (const event of state) {
            if (event['state_key'] === '' && event['type'] === SHORTCODE_EVENT_TYPE) {
                this.shortcode = (event['content'] || {})['shortcode'] || null;
                continue;
            }

            if (event['state_key'] === '' || !ALL_RULE_TYPES.includes(event['type'])) {
                continue;
            }

            let kind: string|null = null;
            if (USER_RULE_TYPES.includes(event['type'])) {
                kind = RULE_USER;
            } else if (ROOM_RULE_TYPES.includes(event['type'])) {
                kind = RULE_ROOM;
            } else if (SERVER_RULE_TYPES.includes(event['type'])) {
                kind = RULE_SERVER;
            } else {
                continue; // invalid/unknown
            }

            const previousState = this.getState(kind, event['state_key']);

            // Now we need to figure out if the current event is of an obsolete type
            // (e.g. org.matrix.mjolnir.rule.user) when compared to the previousState (which might be m.policy.rule.user).
            // We do not want to overwrite a rule of a newer type with an older type even if the event itself is supposedly more recent
            // as it may be someone deleting the older versions of the rules.
            if (previousState) {
                const logObsoleteRule = () => {
                    LogService.info('BanList', `In BanList ${this.roomRef}, conflict between rules ${event['event_id']} (with obsolete type ${event['type']}) ` +
                        `and ${previousState['event_id']} (with standard type ${previousState['type']}). Ignoring rule with obsolete type.`);
                }
                if (kind === RULE_USER && USER_RULE_TYPES.indexOf(event['type']) > USER_RULE_TYPES.indexOf(previousState['type'])) {
                    logObsoleteRule();
                    continue;
                } else if (kind === RULE_ROOM && ROOM_RULE_TYPES.indexOf(event['type']) > ROOM_RULE_TYPES.indexOf(previousState['type'])) {
                    logObsoleteRule();
                    continue;
                } else if (kind === RULE_SERVER && SERVER_RULE_TYPES.indexOf(event['type']) > SERVER_RULE_TYPES.indexOf(previousState['type'])) {
                    logObsoleteRule();
                    continue;
                }
            }

            // The reason we set the state at this point is because it is valid to want to set the state to an invalid rule
            // in order to mark a rule as deleted.
            // We always set state with the normalised state type via `kind` to de-duplicate rules.
            this.setState(kind, event['state_key'], event);
            const changeType: null|ChangeType = (() => {
                if (!previousState) {
                    return ChangeType.Added;
                } else if (previousState['event_id'] === event['event_id']) {
                    if (event['unsigned']?.['redacted_because']) {
                        return ChangeType.Removed;
                    } else {
                        // Nothing has changed.
                        return null;
                    }
                } else {
                    // Then the policy has been modified in some other way, possibly 'soft' redacted by a new event with empty content...
                    if (Object.keys(event['content']).length === 0) {
                        return ChangeType.Removed;
                    } else {
                        return ChangeType.Modified;
                    }
                }
            })();

            // If we haven't got any information about what the rule used to be, then it wasn't a valid rule to begin with
            // and so will not have been used. Removing a rule like this therefore results in no change.
            if (changeType === ChangeType.Removed && previousState?.unsigned?.rule) {
                const sender = event.unsigned['redacted_because'] ? event.unsigned['redacted_because']['sender'] : event.sender;
                changes.push({changeType, event, sender, rule: previousState.unsigned.rule,
                    ... previousState ? {previousState} : {} });
                // Event has no content and cannot be parsed as a ListRule.
                continue;
            }
            // It's a rule - parse it
            const content = event['content'];
            if (!content) continue;

            const entity = content['entity'];
            const recommendation = content['recommendation'];
            const reason = content['reason'] || '<no reason>';

            if (!entity || !recommendation) {
                continue;
            }
            const rule = new ListRule(entity, recommendation, reason, kind);
            event.unsigned.rule = rule;
            if (changeType) {
                changes.push({rule, changeType, event, sender: event.sender, ... previousState ? {previousState} : {} });
            }
        }
        this.emit('BanList.update', this, changes);
        return changes;
    }
}

export default BanList;
