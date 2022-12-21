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

import { extractRequestError, LogLevel, LogService, Permalinks, RoomCreateOptions, UserID } from "matrix-bot-sdk";
import { EventEmitter } from "events";
import { ALL_RULE_TYPES, EntityType, ListRule, Recommendation, ROOM_RULE_TYPES, RULE_ROOM, RULE_SERVER, RULE_USER, SERVER_RULE_TYPES, USER_RULE_TYPES } from "./ListRule";
import { MatrixSendClient } from "../MatrixEmitter";
import AwaitLock from "await-lock";
import { monotonicFactory } from "ulidx";
import { Mjolnir } from "../Mjolnir";

/**
 * Account data event type used to store the permalinks to each of the policylists.
 *
 * Content:
 * ```jsonc
 * {
 *   references: string[], // Each entry is a `matrix.to` permalink.
 * }
 * ```
 */
export const WATCHED_LISTS_EVENT_TYPE = "org.matrix.mjolnir.watched_lists";

/**
 * A prefix used to record that we have already warned at least once that a PolicyList room is unprotected.
 */
const WARN_UNPROTECTED_ROOM_EVENT_PREFIX = "org.matrix.mjolnir.unprotected_room_warning.for.";
export const SHORTCODE_EVENT_TYPE = "org.matrix.mjolnir.shortcode";

export enum ChangeType {
    Added = "ADDED",
    Removed = "REMOVED",
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

declare interface PolicyList {
    // PolicyList.update is emitted when the PolicyList has pulled new rules from Matrix and informs listeners of any changes.
    on(event: 'PolicyList.update', listener: (list: PolicyList, changes: ListRuleChange[], revision: Revision) => void): this
    emit(event: 'PolicyList.update', list: PolicyList, changes: ListRuleChange[], revision: Revision): boolean
}

/**
 * The PolicyList caches all of the rules that are active in a policy room so Mjolnir can refer to when applying bans etc.
 * This cannot be used to update events in the modeled room, it is a readonly model of the policy room.
 *
 * The policy list needs to be updated manually, it has no way of knowing about new events in it's modelled matrix room on its own.
 * You can inform the PolicyList about new events in the matrix side of policy room with the `updateForEvent`, this will eventually
 * cause the PolicyList to update its view of the room (via `updateList`) if it doesn't know about that state event.
 * Each time the PolicyList has finished updating, it will emit the `'PolicyList.update'` event on itself as an EventEmitter.
 *
 * Implementation note: The reason why the PolicyList has to update via a call to `/state` is because
 * you cannot rely on the timeline portion of `/sync` to provide a consistent view of the room state as you
 * receive events in stream order.
 */
class PolicyList extends EventEmitter {
    private shortcode: string | null = null;
    // A map of state events indexed first by state type and then state keys.
    private state: Map<string, Map<string, any>> = new Map();
    /**
     * Allow us to detect whether we have updated the state for this event.
     */
    private stateByEventId: Map<string /* event id */, any> = new Map();
    // Batches new events from sync together before starting the process to update the list.
    private readonly batcher: UpdateBatcher;
    // Events that we have already informed the batcher about, that we haven't loaded from the room state yet.
    private batchedEvents = new Set<string /* event id */>();

    /** MSC3784 support. Please note that policy lists predate room types. So there will be lists in the wild without this type. */
    public static readonly ROOM_TYPE = "support.feline.policy.lists.msc.v1";
    public static readonly ROOM_TYPE_VARIANTS = [PolicyList.ROOM_TYPE]

    /**
     * This is used to annotate state events we store with the rule they are associated with.
     * If we refactor this, it is important to also refactor any listeners to 'PolicyList.update'
     * which may assume `ListRule`s that are removed will be identital (Object.is) to when they were added.
     * If you are adding new listeners, you should check the source event_id of the rule.
     */
    private static readonly EVENT_RULE_ANNOTATION_KEY = 'org.matrix.mjolnir.annotation.rule';

    /**
     * An ID that represents the current version of the list state.
     * Each time we use `updateList` we create a new revision to represent the change of state.
     * Listeners can then use the revision to work out whether they have already applied
     * the latest revision.
     */
    private revisionId = new Revision();

    /**
     * A lock to protect `updateList` from a situation where one call to `getRoomState` can start and end before another.
     */
    private readonly updateListLock = new AwaitLock();
    /**
     * Construct a PolicyList, does not synchronize with the room.
     * @param roomId The id of the policy room, i.e. a room containing MSC2313 policies.
     * @param roomRef A sharable/clickable matrix URL that refers to the room.
     * @param client A matrix client that is used to read the state of the room when `updateList` is called.
     */
    constructor(public readonly roomId: string, public readonly roomRef: string, private client: MatrixSendClient) {
        super();
        this.batcher = new UpdateBatcher(this);
    }

    /**
     * Create a new policy list.
     * @param client A MatrixClient that will be used to create the list.
     * @param shortcode A shortcode to refer to the list with.
     * @param invite A list of users to invite to the list and make moderator.
     * @param createRoomOptions Additional room create options such as an alias.
     * @returns The room id for the newly created policy list.
     */
    public static async createList(
        client: MatrixSendClient,
        shortcode: string,
        invite: string[],
        createRoomOptions: RoomCreateOptions = {}
    ): Promise<string /* room id */> {
        const powerLevels: { [key: string]: any } = {
            "ban": 50,
            "events": {
                "m.room.name": 100,
                "m.room.power_levels": 100,
            },
            "events_default": 50, // non-default
            "invite": 0,
            "kick": 50,
            "notifications": {
                "room": 20,
            },
            "redact": 50,
            "state_default": 50,
            "users": {
                [await client.getUserId()]: 100,
                ...invite.reduce((users, mxid) => ({...users,  [mxid]: 50 }), {}),
            },
            "users_default": 0,
        };
        const finalRoomCreateOptions: RoomCreateOptions = {
            // Support for MSC3784.
            creation_content: {
                type: PolicyList.ROOM_TYPE
            },
            preset: "public_chat",
            invite,
            initial_state: [
                {
                    type: SHORTCODE_EVENT_TYPE,
                    state_key: "",
                    content: {shortcode: shortcode}
                }
            ],
            power_level_content_override: powerLevels,
            ...createRoomOptions
        };
        // Guard room type in case someone overwrites it when declaring custom creation_content in future code.
        const roomType = finalRoomCreateOptions.creation_content?.type;
        if (typeof roomType !== 'string' || !PolicyList.ROOM_TYPE_VARIANTS.includes(roomType)) {
            throw new TypeError(`Creating a policy room with a type other than the policy room type is not supported, you probably don't want to do this.`);
        }
        const listRoomId = await client.createRoom(finalRoomCreateOptions);
        return listRoomId
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
        this.stateByEventId.set(event.event_id, event);
    }

    /**
     * Return all the active rules of a given kind.
     * @param kind e.g. RULE_SERVER (m.policy.rule.server). Rule types are always normalised when they are interned into the PolicyList.
     * @param recommendation A specific recommendation to filter for e.g. `m.ban`. Please remember recommendation varients are normalized.
     * @returns The active ListRules for the ban list of that kind.
     */
    public rulesOfKind(kind: string, recommendation?: Recommendation): ListRule[] {
        const rules: ListRule[] = []
        const stateKeyMap = this.state.get(kind);
        if (stateKeyMap) {
            for (const event of stateKeyMap.values()) {
                const rule = event[PolicyList.EVENT_RULE_ANNOTATION_KEY];
                if (rule && rule.kind === kind) {
                    if (recommendation === undefined) {
                        rules.push(rule);
                    } else if (rule.recommendation === recommendation) {
                        rules.push(rule);
                    }
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
     * Return all of the rules in this list that will match the provided entity.
     * If the entity is a user, then we match the domain part against server rules too.
     * @param ruleKind The type of rule for the entity e.g. `RULE_USER`.
     * @param entity The entity to test e.g. the user id, server name or a room id.
     * @returns All of the rules that match this entity.
     */
    public rulesMatchingEntity(entity: string, ruleKind?: string): ListRule[] {
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
     * Ban an entity with Recommendation.Ban from the list.
     * @param ruleType The type of rule e.g. RULE_USER.
     * @param entity The entity to ban.
     * @param reason A reason we are banning them.
     */
    public async banEntity(ruleType: string, entity: string, reason?: string): Promise<void> {
        // '@' at the beginning of state keys is reserved.
        const stateKey = ruleType === RULE_USER ? '_' + entity.substring(1) : entity;
        const event_id = await this.client.sendStateEvent(this.roomId, ruleType, stateKey, {
            entity,
            recommendation: Recommendation.Ban,
            reason: reason || '<no reason supplied>',
        });
        this.updateForEvent(event_id);
    }

    /**
     * Remove all rules in the banList for this entity that have the same state key (as when we ban them)
     * by searching for rules that have legacy state types.
     * @param ruleType The normalized (most recent) type for this rule e.g. `RULE_USER`.
     * @param entity The entity to unban from this list.
     * @returns true if any rules were removed and the entity was unbanned, otherwise false because there were no rules.
     */
    public async unbanEntity(ruleType: string, entity: string): Promise<boolean> {
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
        const sendNullState = async (stateType: string, stateKey: string) => {
            const event_id = await this.client.sendStateEvent(this.roomId, stateType, stateKey, {});
            this.updateForEvent(event_id);
        }
        const removeRule = async (rule: ListRule): Promise<void> => {
            const stateKey = rule.sourceEvent.state_key;
            // We can't cheat and check our state cache because we normalize the event types to the most recent version.
            const typesToRemove = (await Promise.all(
                typesToCheck.map(stateType => this.client.getRoomStateEvent(this.roomId, stateType, stateKey)
                    .then(_ => stateType) // We need the state type as getRoomState only returns the content, not the top level.
                    .catch(e => e.statusCode === 404 ? null : Promise.reject(e))))
                ).filter(e => e); // remove nulls. I don't know why TS still thinks there can be nulls after this??
            if (typesToRemove.length === 0) {
                return;
            }
            await Promise.all(typesToRemove.map(stateType => sendNullState(stateType!, stateKey)));
        }
        const rules = this.rulesMatchingEntity(entity, ruleType);
        await Promise.all(rules.map(removeRule));
        return rules.length > 0;
    }

    /**
     * Synchronise the model with the room representing the ban list by reading the current state of the room
     * and updating the model to reflect the room.
     * @returns A description of any rules that were added, modified or removed from the list as a result of this update.
     */
    public async updateList(): Promise<ReturnType<PolicyList["updateListWithState"]>> {
        await this.updateListLock.acquireAsync();
        try {
            const state = await this.client.getRoomState(this.roomId);
            return this.updateListWithState(state);
        } finally {
            this.updateListLock.release();
        }
    }

    /**
     * Same as `updateList` but without async to make sure that no one uses await within the body.
     * The reason no one should use await is to avoid a horrible race should `updateList` be called more than once.
     * @param state Room state to update the list with, provided by `updateList`
     * @returns Any changes that have been made to the PolicyList.
     */
    private updateListWithState(state: any): { revision: Revision, changes: ListRuleChange[] } {
        const changes: ListRuleChange[] = [];
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

            // Clear out any events that we were informed about via updateForEvent.
            if (changeType !== null) {
                this.batchedEvents.delete(event.event_id)
            }

            // If we haven't got any information about what the rule used to be, then it wasn't a valid rule to begin with
            // and so will not have been used. Removing a rule like this therefore results in no change.
            if (changeType === ChangeType.Removed && previousState?.[PolicyList.EVENT_RULE_ANNOTATION_KEY]) {
                const sender = event.unsigned['redacted_because'] ? event.unsigned['redacted_because']['sender'] : event.sender;
                changes.push({
                    changeType, event, sender, rule: previousState[PolicyList.EVENT_RULE_ANNOTATION_KEY],
                    ...previousState ? { previousState } : {}
                });
                // Event has no content and cannot be parsed as a ListRule.
                continue;
            }
            // It's a rule - parse it
            const rule = ListRule.parse(event);
            if (!rule) {
                // Invalid/unknown rule, just skip it.
                continue;
            }
            event[PolicyList.EVENT_RULE_ANNOTATION_KEY] = rule;
            if (changeType) {
                changes.push({ rule, changeType, event, sender: event.sender, ...previousState ? { previousState } : {} });
            }
        }
        if (changes.length > 0) {
            this.revisionId = new Revision();
            this.emit('PolicyList.update', this, changes, this.revisionId);
        }
        if (this.batchedEvents.keys.length !== 0) {
            // The only reason why this isn't a TypeError is because we need to know about this when it happens, because it means
            // we're probably doing something wrong, on the other hand, if someone messes with a server implementation and
            // strange things happen where events appear in /sync sooner than they do in /state (which would be outrageous)
            // we don't want Mjolnir to stop working properly. Though, I am not confident a burried warning is going to alert us.
            LogService.warn("PolicyList", "The policy list is being informed about events that it cannot find in the room state, this is really bad and you should seek help.");
        }
        return { revision: this.revisionId, changes };
    }

    /**
     * Inform the `PolicyList` about a new event from the room it is modelling.
     * @param event An event from the room the `PolicyList` models to inform an instance about.
     */
    public updateForEvent(eventId: string): void {
        if (this.stateByEventId.has(eventId) || this.batchedEvents.has(eventId)) {
            return; // we already know about this event.
        }
        this.batcher.addToBatch(eventId);
        this.batchedEvents.add(eventId);
    }
}

export default PolicyList;

/**
 * Helper class that emits a batch event on a `PolicyList` when it has made a batch
 * out of the Matrix events given to `addToBatch` via `updateForEvent`.
 * The `UpdateBatcher` will then call `list.update()` on the associated `PolicyList` once it has finished batching events.
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
        // batching finished, update the associated list.
        await this.banList.updateList();
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

/**
 * Represents a specific version of the state contained in `PolicyList`.
 * These are unique and can be compared with `supersedes`.
 * We use a ULID to work out whether a revision supersedes another.
 */
export class Revision {

    /**
     * Ensures that ULIDs are monotonic.
     */
    private static makeULID = monotonicFactory();

    /**
     * Is only public for the comparison method,
     * I feel like I'm missing something here and it is possible without
     */
    public readonly ulid = Revision.makeULID();

    constructor() {
        // nothing to do.
    }

    /**
     * Check whether this revision supersedes another revision.
     * @param revision The revision we want to check this supersedes.
     * @returns True if this Revision supersedes the other revision.
     */
    public supersedes(revision: Revision): boolean {
        return this.ulid > revision.ulid;
    }
}

/**
 * A manager for all the policy lists for this Mjölnir
 */
export class PolicyListManager {
    private policyLists: PolicyList[];

    /**
     * A list of references (matrix.to URLs) to policy lists that
     * we could not resolve during startup. We store them to make
     * sure that they're written back whenever we rewrite the references
     * to account data.
     */
    private readonly failedStartupWatchListRefs: Set<string> = new Set();

    constructor(private readonly mjolnir: Mjolnir) {
        // Nothing to do.
    }

    public get lists(): PolicyList[] {
        return this.policyLists;
    }

    /**
     * Helper for constructing `PolicyList`s and making sure they have the right listeners set up.
     * @param roomId The room id for the `PolicyList`.
     * @param roomRef A reference (matrix.to URL) for the `PolicyList`.
     */
    private async addPolicyList(roomId: string, roomRef: string): Promise<PolicyList> {
        const list = new PolicyList(roomId, roomRef, this.mjolnir.client);
        this.mjolnir.ruleServer?.watch(list);
        await list.updateList();
        this.policyLists.push(list);
        this.mjolnir.protectedRoomsTracker.watchList(list);

        // If we have succeeded, let's remove this from the list of failed policy rooms.
        this.failedStartupWatchListRefs.delete(roomRef);
        return list;
    }

    public async watchList(roomRef: string): Promise<PolicyList | null> {
        const joinedRooms = await this.mjolnir.client.getJoinedRooms();
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.mjolnir.client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            await this.mjolnir.client.joinRoom(roomId, permalink.viaServers);
        }

        if (this.policyLists.find(b => b.roomId === roomId)) {
            // This room was already in our list of policy rooms, nothing else to do.
            // Note that we bailout *after* the call to `joinRoom`, in case a user
            // calls `watchList` in an attempt to repair something that was broken,
            // e.g. a Mjölnir who could not join the room because of alias resolution
            // or server being down, etc.
            return null;
        }

        const list = await this.addPolicyList(roomId, roomRef);

        await this.storeWatchedPolicyLists();

        await this.warnAboutUnprotectedPolicyListRoom(roomId);

        return list;
    }

    public async unwatchList(roomRef: string): Promise<PolicyList | null> {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.mjolnir.client.resolveRoom(permalink.roomIdOrAlias);
        this.failedStartupWatchListRefs.delete(roomRef);
        const list = this.policyLists.find(b => b.roomId === roomId) || null;
        if (list) {
            this.policyLists.splice(this.policyLists.indexOf(list), 1);
            this.mjolnir.ruleServer?.unwatch(list);
            this.mjolnir.protectedRoomsTracker.unwatchList(list);
        }

        await this.storeWatchedPolicyLists();
        return list;
    }

    /**
     * Load the watched policy lists from account data, only used when Mjolnir is initialized.
     */
    public async init() {
        this.policyLists = [];
        const joinedRooms = await this.mjolnir.client.getJoinedRooms();

        let watchedListsEvent: { references?: string[] } | null = null;
        try {
            watchedListsEvent = await this.mjolnir.client.getAccountData(WATCHED_LISTS_EVENT_TYPE);
        } catch (e) {
            if (e.statusCode === 404) {
                LogService.warn('Mjolnir', "Couldn't find account data for Mjolnir's watched lists, assuming first start.", extractRequestError(e));
            } else {
                throw e;
            }
        }

        for (const roomRef of (watchedListsEvent?.references || [])) {
            const permalink = Permalinks.parseUrl(roomRef);
            if (!permalink.roomIdOrAlias) continue;

            let roomId;
            try {
                roomId = await this.mjolnir.client.resolveRoom(permalink.roomIdOrAlias);
            } catch (ex) {
                // Let's not fail startup because of a problem resolving a room id or an alias.
                LogService.warn('Mjolnir', 'Could not resolve policy list room, skipping for this run', permalink.roomIdOrAlias)
                await this.mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "Mjolnir", `Room ${permalink.roomIdOrAlias} could **not** be resolved, perhaps a server is down? Skipping this room. If this is a recurring problem, please consider removing this room.`);
                this.failedStartupWatchListRefs.add(roomRef);
                continue;
            }
            if (!joinedRooms.includes(roomId)) {
                await this.mjolnir.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
            }

            await this.warnAboutUnprotectedPolicyListRoom(roomId);
            await this.addPolicyList(roomId, roomRef);
        }
    }

    /**
     * Store to account the list of policy rooms.
     *
     * We store both rooms that we are currently monitoring and rooms for which
     * we could not setup monitoring, assuming that the setup is a transient issue
     * that the user (or someone else) will eventually resolve.
     */
    private async storeWatchedPolicyLists() {
        let list = this.policyLists.map(b => b.roomRef);
        for (let entry of this.failedStartupWatchListRefs) {
            list.push(entry);
        }
        await this.mjolnir.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: list,
        });
    }

    /**
     * Check whether a policy list room is protected. If not, display
     * a user-readable warning.
     *
     * We store as account data the list of room ids for which we have
     * already displayed the warning, to avoid bothering users at every
     * single startup.
     *
     * @param roomId The id of the room to check/warn.
     */
    private async warnAboutUnprotectedPolicyListRoom(roomId: string) {
        if (!this.mjolnir.config.protectAllJoinedRooms) {
            return; // doesn't matter
        }
        if (this.mjolnir.explicitlyProtectedRooms.includes(roomId)) {
            return; // explicitly protected
        }

        try {
            const accountData: { warned: boolean } | null = await this.mjolnir.client.getAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId);
            if (accountData && accountData.warned) {
                return; // already warned
            }
        } catch (e) {
            // Expect that we haven't warned yet.
        }

        await this.mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "Mjolnir", `Not protecting ${roomId} - it is a ban list that this bot did not create. Add the room as protected if it is supposed to be protected. This warning will not appear again.`, roomId);
        await this.mjolnir.client.setAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId, { warned: true });
    }
}