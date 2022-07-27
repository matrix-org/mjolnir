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

import { extractRequestError, LogService, MatrixClient, UserID } from "matrix-bot-sdk";
import { EventEmitter } from "events";
import { ALL_RULE_TYPES, EntityType, PolicyRule, Recommendation, ROOM_RULE_TYPES, RULE_ROOM, RULE_SERVER, RULE_USER, SERVER_RULE_TYPES, USER_RULE_TYPES } from "./PolicyRule";

export const SHORTCODE_EVENT_TYPE = "org.matrix.mjolnir.shortcode";

export enum ChangeType {
    Added = "ADDED",
    Removed = "REMOVED",
    Modified = "MODIFIED"
}

export interface PolicyRuleChange {
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
    readonly rule: PolicyRule,
    /**
     * The previous state that has been changed. Only (and always) provided when the change type is `ChangeType.Removed` or `Modified`.
     * This will be a copy of the same event as `event` when a redaction has occurred and this will show its unredacted state.
     */
    readonly previousState?: any,
}

declare interface PolicyList {
    // PolicyList.update is emitted when the PolicyList has pulled new rules from Matrix and informs listeners of any changes.
    on(event: 'PolicyList.update', listener: (list: PolicyList, changes: PolicyRuleChange[]) => void): this
    emit(event: 'PolicyList.update', list: PolicyList, changes: PolicyRuleChange[]): boolean
    // PolicyList.batch is emitted when the PolicyList has created a batch from the events provided by `updateForEvent`.
    on(event: 'PolicyList.batch', listener: (list: PolicyList) => void): this
    emit(event: 'PolicyList.batch', list: PolicyList): boolean
}

/**
 * The PolicyList caches all of the rules that are active in a policy room so Mjolnir can refer to when applying bans etc.
 * This cannot be used to update events in the modeled room, it is a readonly model of the policy room.
 */
class PolicyList extends EventEmitter {
    private shortcode: string | null = null;
    // A map of state events indexed first by state type and then state keys.
    private state: Map<string, Map<string, any>> = new Map();
    // Batches new events from sync together before starting the process to update the list.
    private readonly batcher: UpdateBatcher;

    /**
     * Construct a PolicyList, does not synchronize with the room.
     * @param roomId The id of the policy room, i.e. a room containing MSC2313 policies.
     * @param roomRef A sharable/clickable matrix URL that refers to the room.
     * @param client A matrix client that is used to read the state of the room when `updateList` is called.
     */
    constructor(public readonly roomId: string, public readonly roomRef: string, private client: MatrixClient) {
        super();
        this.batcher = new UpdateBatcher(this);
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
     * Store this state event as part of the active room state for this PolicyList (used to cache rules).
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
     * @param kind e.g. RULE_SERVER (m.policy.rule.server). Rule types are always normalised when they are interned into the PolicyList.
     * @returns The active PolicyRules for the ban list of that kind.
     */
    private rulesOfKind(kind: string): PolicyRule[] {
        const rules: PolicyRule[] = []
        const stateKeyMap = this.state.get(kind);
        if (stateKeyMap) {
            for (const event of stateKeyMap.values()) {
                const rule = event?.unsigned?.rule;
                // README! If you are refactoring this and/or introducing a mechanism to return the list of rules,
                // please make sure that you *only* return rules with `m.ban` or create a different method
                // (we don't want to accidentally ban entities).
                if (rule && rule.kind === kind && rule.recommendation === Recommendation.Ban) {
                    rules.push(rule);
                }
            }
        }
        return rules;
    }

    public set listShortcode(newShortcode: string) {
        const currentShortcode = this.shortcode;
        this.shortcode = newShortcode;
        this.client.sendStateEvent(this.roomId, SHORTCODE_EVENT_TYPE, '', { shortcode: this.shortcode }).catch(err => {
            LogService.error("PolicyList", extractRequestError(err));
            if (this.shortcode === newShortcode) this.shortcode = currentShortcode;
        });
    }

    public get serverRules(): PolicyRule[] {
        return this.rulesOfKind(RULE_SERVER);
    }

    public get userRules(): PolicyRule[] {
        return this.rulesOfKind(RULE_USER);
    }

    public get roomRules(): PolicyRule[] {
        return this.rulesOfKind(RULE_ROOM);
    }

    public get allRules(): PolicyRule[] {
        return [...this.serverRules, ...this.userRules, ...this.roomRules];
    }

    /**
     * Return all of the rules in this list that will match the provided entity.
     * If the entity is a user, then we match the domain part against server rules too.
     * @param ruleKind The type of rule for the entity e.g. `RULE_USER`.
     * @param entity The entity to test e.g. the user id, server name or a room id.
     * @returns All of the rules that match this entity.
     */
    public rulesMatchingEntity(entity: string, ruleKind?: string): PolicyRule[] {
        const ruleTypeOf: (entityPart: string) => string = (entityPart: string) => {
            if (ruleKind) {
                return ruleKind;
            } else if (entityPart.startsWith("#") || entityPart.startsWith("#")) {
                return RULE_ROOM;
            } else if (entity.startsWith("@")) {
                return RULE_USER;
            } else {
                return RULE_SERVER;
            }
        };

        if (ruleTypeOf(entity) === RULE_USER) {
            // We special case because want to see whether a server ban is preventing this user from participating too.
            const userId = new UserID(entity);
            return [
                ...this.userRules.filter(rule => rule.isMatch(entity)),
                ...this.serverRules.filter(rule => rule.isMatch(userId.domain))
            ]
        } else {
            return this.rulesOfKind(ruleTypeOf(entity)).filter(rule => rule.isMatch(entity));
        }
    }

    /**
     * Remove all rules in the banList for this entity that have the same state key (as when we ban them)
     * by searching for rules that have legacy state types.
     * @param ruleType The normalized (most recent) type for this rule e.g. `RULE_USER`.
     * @param entity The entity to unban from this list.
     * @returns true if any rules were removed and the entity was unbanned, otherwise false because there were no rules.
     */
    public async unbanEntity(ruleType: string, entity: string): Promise<boolean> {
        const stateKey = `rule:${entity}`;
        let typesToCheck = [ruleType];
        switch (ruleType) {
            case RULE_USER:
                typesToCheck = USER_RULE_TYPES;
                break;
            case RULE_SERVER:
                typesToCheck = SERVER_RULE_TYPES;
                break;
            case RULE_ROOM:
                typesToCheck = ROOM_RULE_TYPES;
                break;
        }
        // We can't cheat and check our state cache because we normalize the event types to the most recent version.
        const typesToRemove = (await Promise.all(
            typesToCheck.map(stateType => this.client.getRoomStateEvent(this.roomId, stateType, stateKey)
                .then(_ => stateType) // We need the state type as getRoomState only returns the content, not the top level.
                .catch(e => e.statusCode === 404 ? null : Promise.reject(e))))
        ).filter(e => e); // remove nulls. I don't know why TS still thinks there can be nulls after this??
        if (typesToRemove.length === 0) {
            return false;
        }
        await Promise.all(typesToRemove.map(stateType => this.client.sendStateEvent(this.roomId, stateType!, stateKey, {})));
        return true;
    }

    /**
     * Synchronise the model with the room representing the ban list by reading the current state of the room
     * and updating the model to reflect the room.
     * @returns A description of any rules that were added, modified or removed from the list as a result of this update.
     */
    public async updateList(): Promise<PolicyRuleChange[]> {
        let changes: PolicyRuleChange[] = [];

        const state = await this.client.getRoomState(this.roomId);
        for (const event of state) {
            if (event['state_key'] === '' && event['type'] === SHORTCODE_EVENT_TYPE) {
                this.shortcode = (event['content'] || {})['shortcode'] || null;
                continue;
            }

            if (event['state_key'] === '' || !ALL_RULE_TYPES.includes(event['type'])) {
                continue;
            }

            let kind: EntityType | null = null;
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
                    LogService.info('PolicyList', `In PolicyList ${this.roomRef}, conflict between rules ${event['event_id']} (with obsolete type ${event['type']}) ` +
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
            const changeType: null | ChangeType = (() => {
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
                changes.push({
                    changeType, event, sender, rule: previousState.unsigned.rule,
                    ...previousState ? { previousState } : {}
                });
                // Event has no content and cannot be parsed as a PolicyRule.
                continue;
            }
            // It's a rule - parse it
            const rule = PolicyRule.parse(event);
            if (!rule) {
                // Invalid/unknown rule, just skip it.
                continue;
            }
            event.unsigned.rule = rule;
            if (changeType) {
                changes.push({ rule, changeType, event, sender: event.sender, ...previousState ? { previousState } : {} });
            }
        }
        this.emit('PolicyList.update', this, changes);
        return changes;
    }

    /**
     * Inform the `PolicyList` about a new event from the room it is modelling.
     * @param event An event from the room the `PolicyList` models to inform an instance about.
     */
    public updateForEvent(event: { event_id: string }): void {
        this.batcher.addToBatch(event.event_id)
    }
}

export default PolicyList;

/**
 * Helper class that emits a batch event on a `PolicyList` when it has made a batch
 * out of the events given to `addToBatch`.
 */
class UpdateBatcher {
    // Whether we are waiting for more events to form a batch.
    private isWaiting = false;
    // The latest (or most recent) event we have received.
    private latestEventId: string | null = null;
    private readonly waitPeriodMS = 200; // 200ms seems good enough.
    private readonly maxWaitMS = 3000; // 3s is long enough to wait while batching.

    constructor(private readonly banList: PolicyList) {

    }

    /**
     * Reset the state for the next batch.
     */
    private reset() {
        this.latestEventId = null;
        this.isWaiting = false;
    }

    /**
     * Checks if any more events have been added to the current batch since
     * the previous iteration, then keep waiting up to `this.maxWait`, otherwise stop
     * and emit a batch.
     * @param eventId The id of the first event for this batch.
     */
    private async checkBatch(eventId: string): Promise<void> {
        let start = Date.now();
        do {
            await new Promise(resolve => setTimeout(resolve, this.waitPeriodMS));
        } while ((Date.now() - start) < this.maxWaitMS && this.latestEventId !== eventId)
        this.reset();
        this.banList.emit('PolicyList.batch', this.banList);
    }

    /**
     * Adds an event to the batch.
     * @param eventId The event to inform the batcher about.
     */
    public addToBatch(eventId: string): void {
        if (this.isWaiting) {
            this.latestEventId = eventId;
            return;
        }
        this.latestEventId = eventId;
        this.isWaiting = true;
        // We 'spawn' off here after performing the checks above
        // rather than before (ie if `addToBatch` was async) because
        // `banListTest` showed that there were 100~ ACL events per protected room
        // as compared to just 5~ by doing this. Not entirely sure why but it probably
        // has to do with queuing up `n event` tasks on the event loop that exaust scheduling
        // (so the latency between them is percieved as much higher by
        // the time they get checked in `this.checkBatch`, thus batching fails).
        this.checkBatch(eventId);
    }
}
