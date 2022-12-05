import { MatrixEmitter } from "./MatrixEmitter";

enum Action {
    Join,
    Leave,
    Other
}

const LEAVE_OR_BAN = ['leave', 'ban'];

/**
 * Storing a join event.
 *
 * We use `timestamp`:
 * - to avoid maintaining tens of thousands of in-memory `Date` objects;
 * - to ensure immutability.
 */
export class Join {
    constructor(
        public readonly userId: string,
        public readonly timestamp: number
    ) { }
}

/**
 * A data structure maintaining a list of joins since the start of Mjölnir.
 *
 * This data structure is optimized for lookup up of recent joins.
 */
class RoomMembers {
    /**
     * The list of recent joins, ranked from oldest to most recent.
     *
     * Note that a user may show up in both `_joinsByTimestamp` and `_leaves`, in which case
     * they have both joined and left recently. Compare the date of the latest
     * leave event (in `_leaves`) to the date of the join to determine whether
     * the user is still present.
     *
     * Note that a user may show up more than once in `_joinsByTimestamp` if they have
     * left and rejoined.
     */
    private _joinsByTimestamp: Join[] = [];
    private _joinsByUser: Map<string /* user id */, number /* timestamp */> = new Map();

    /**
     * The list of recent leaves.
     *
     * If a user rejoins and leaves again, the latest leave event overwrites
     * the oldest.
     */
    private _leaves: Map<string /* user id */, number /* timestamp */> = new Map();

    /**
     * Record a join.
     */
    public join(userId: string, timestamp: number) {
        this._joinsByTimestamp.push(new Join(userId, timestamp));
        this._joinsByUser.set(userId, timestamp);
    }

    /**
     * Record a leave.
     */
    public leave(userId: string, timestamp: number) {
        if (!this._joinsByUser.has(userId)) {
            // No need to record a leave for a user we didn't see joining.
            return;
        }
        this._leaves.set(userId, timestamp);
        this._joinsByUser.delete(userId);
    }

    /**
     * Run a cleanup on the data structure.
     */
    public cleanup() {
        if (this._leaves.size === 0) {
            // Nothing to do.
            return;
        }
        this._joinsByTimestamp = this._joinsByTimestamp.filter(join => this.isStillValid(join));
        this._leaves = new Map();
    }

    /**
     * Determine whether a `join` is still valid or has been superseded by a `leave`.
     *
     * @returns true if the `join` is still valid.
     */
    private isStillValid(join: Join): boolean {
        const leaveTS = this._leaves.get(join.userId);
        if (!leaveTS) {
            // The user never left.
            return true;
        }
        if (leaveTS > join.timestamp) {
            // The user joined, then left, ignore this join.
            return false;
        }
        // The user had left, but this is a more recent re-join.
        return true;
    }

    /**
     * Return a subset of the list of all the members, with their join date.
     *
     * @param since Only return members who have last joined at least as
     * recently as `since`.
     * @param max Only return at most `max` numbers.
     * @returns A list of up to `max` members joined since `since`, ranked
     * from most recent join to oldest join.
     */
    public members(since: Date, max: number): Join[] {
        const result = [];
        const ts = since.getTime();
        // Spurious joins are legal, let's deduplicate them.
        const users = new Set();
        for (let i = this._joinsByTimestamp.length - 1; i >= 0; --i) {
            if (result.length > max) {
                // We have enough entries, let's return immediately.
                return result;
            }
            const join = this._joinsByTimestamp[i];
            if (join.timestamp < ts) {
                // We have reached an older entry, everything will be `< since`,
                // we won't find any other join to return.
                return result;
            }
            if (this.isStillValid(join) && !users.has(join.userId)) {
                // This entry is still valid, we'll need to return it.
                result.push(join);
                users.add(join.userId);
            }
        }
        // We have reached the startup of Mjölnir.
        return result;
    }

    /**
     * Return the join date of a user.
     *
     * @returns a `Date` if the user is currently in the room and has joined
     * since the start of Mjölnir, `null` otherwise.
     */
    public get(userId: string): Date | null {
        let ts = this._joinsByUser.get(userId);
        if (!ts) {
            return null;
        }
        return new Date(ts);
    }
}

export class RoomMemberManager {
    private perRoom: Map<string /* room id */, RoomMembers> = new Map();
    private readonly cbHandleEvent;
    constructor(private client: MatrixEmitter) {
        // Listen for join events.
        this.cbHandleEvent = this.handleEvent.bind(this);
        client.on("room.event", this.cbHandleEvent);
    }

    /**
     * Start listening to join/leave events in a room.
     */
    public addRoom(roomId: string) {
        if (this.perRoom.has(roomId)) {
            // Nothing to do.
            return;
        }
        this.perRoom.set(roomId, new RoomMembers());
    }

    /**
     * Stop listening to join/leave events in a room.
     *
     * Cleanup any remaining data on join/leave events.
     */
    public removeRoom(roomId: string) {
        this.perRoom.delete(roomId);
    }

    public cleanup(roomId: string) {
        this.perRoom.get(roomId)?.cleanup();
    }

    /**
     * Dispose of this object.
     */
    public dispose() {
        this.client.off("room.event", this.cbHandleEvent);
    }

    /**
     * Return the date at which user `userId` has joined room `roomId`, or `null` if
     * that user has joined the room before Mjölnir started watching it.
     *
     * @param roomId The id of the room we're interested in.
     * @param userId The id of the user we're interested in.
     * @returns a Date if Mjölnir has witnessed the user joining the room,
     * `null` otherwise. The latter may happen either if the user has joined
     * the room before Mjölnir or if the user is not currently in the room.
     */
    public getUserJoin(user: { roomId: string, userId: string }): Date | null {
        const { roomId, userId } = user;
        const ts = this.perRoom.get(roomId)?.get(userId) || null;
        if (!ts) {
            return null;
        }
        return new Date(ts);
    }

    /**
     * Get the users in a room, ranked by most recently joined to oldest join.
     *
     * Only the users who have joined since the start of Mjölnir are returned.
     */
    public getUsersInRoom(roomId: string, since: Date, max = 100): Join[] {
        const inRoom = this.perRoom.get(roomId);
        if (!inRoom) {
            return [];
        }
        return inRoom.members(since, max);
    }

    /**
     * Record join/leave events.
     */
    public async handleEvent(roomId: string, event: any, now?: Date) {
        if (event['type'] !== 'm.room.member') {
            // Not a join/leave event.
            return;
        }

        const members = this.perRoom.get(roomId);
        if (!members) {
            // Not a room we are watching.
            return;
        }
        const userId = event['state_key'];
        if (!userId) {
            // Ill-formed event.
            return;
        }

        const userState = event['content']['membership'];
        const prevMembership = event['unsigned']?.['prev_content']?.['membership'] || "leave";

        // We look at the previous membership to filter out profile changes
        let action;
        if (userState === 'join' && prevMembership !== "join") {
            action = Action.Join;
        } else if (LEAVE_OR_BAN.includes(userState) && !LEAVE_OR_BAN.includes(prevMembership)) {
            action = Action.Leave;
        } else {
            action = Action.Other;
        }
        switch (action) {
            case Action.Other:
                // Nothing to do.
                return;
            case Action.Join:
                members.join(userId, now ? now.getTime() : Date.now());
                break;
            case Action.Leave:
                members.leave(userId, now ? now.getTime() : Date.now());
                break;
        }
    }
}