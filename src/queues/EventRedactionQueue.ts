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
import { LogLevel, MatrixClient, MXCUrl } from "@vector-im/matrix-bot-sdk";
import { ERROR_KIND_FATAL } from "../ErrorCache";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { redactUserMessagesIn } from "../utils";
import ManagementRoomOutput from "../ManagementRoomOutput";
import { MatrixSendClient } from "../MatrixEmitter";

export interface QueuedRedaction {
    /** The room which the redaction will take place in. */
    readonly roomId: string;
    /**
     * Carry out the redaction.
     * Called by the EventRedactionQueue.
     * @param client A MatrixClient to use to carry out the redaction.
     */
    redact(client: MatrixSendClient, managementRoom: ManagementRoomOutput): Promise<void>;
    /**
     * Used to test whether the redaction is the equivalent to another redaction.
     * @param redaction Another QueuedRedaction to test if this redaction is an equivalent to.
     */
    redactionEqual(redaction: QueuedRedaction): boolean;
}

/**
 * Redacts all of the messages a user has sent to one room.
 */
export class RedactUserInRoom implements QueuedRedaction {
    constructor(
        public readonly userId: string,
        public readonly roomId: string,
        public readonly isAdmin: boolean,
        public readonly mediaIds: Iterable<MXCUrl>,
    ) {}

    /**
     * Whether this redaction can be carried out by the Synapse admin API, which redacts a user
     * across a list of rooms in a single request. Globs are not supported by the admin endpoint.
     */
    public get isBatchableByAdminApi(): boolean {
        return this.isAdmin && !this.userId.includes("*");
    }

    public async redact(client: MatrixClient, managementRoom: ManagementRoomOutput) {
        await managementRoom.logMessage(
            LogLevel.DEBUG,
            "Mjolnir",
            `Redacting events from ${this.userId} in room ${this.roomId}.`,
        );
        await redactUserMessagesIn(client, managementRoom, this.userId, [this.roomId], this.isAdmin);
    }

    public redactionEqual(redaction: QueuedRedaction): boolean {
        if (redaction instanceof RedactUserInRoom) {
            return redaction.userId === this.userId && redaction.roomId === this.roomId;
        } else {
            return false;
        }
    }
}
/**
 * This is a queue for events so that other protections can happen first (e.g. applying room bans to every room).
 */
export class EventRedactionQueue {
    /**
     * This map is indexed by roomId and its values are a list of redactions waiting to be processed for that room.
     */
    private toRedact: Map<string, QueuedRedaction[]> = new Map<string, QueuedRedaction[]>();

    /**
     * Test whether the redaction is already present in the queue.
     * @param redaction a QueuedRedaction.
     * @returns True if the queue already has the redaction, false otherwise.
     */
    public has(redaction: QueuedRedaction): boolean {
        return !!this.toRedact.get(redaction.roomId)?.find((r) => r.redactionEqual(redaction));
    }

    /**
     * Adds a `QueuedRedaction` to the queue. It will be processed when `process` is called.
     * @param redaction A `QueuedRedaction` to await processing
     * @returns `true` if the redaction was added to the queue, `false` if it is a duplicate of a redaction already present in the queue.
     */
    public add(redaction: QueuedRedaction): boolean {
        if (this.has(redaction)) {
            return false;
        } else {
            let entry = this.toRedact.get(redaction.roomId);
            if (entry) {
                entry.push(redaction);
            } else {
                this.toRedact.set(redaction.roomId, [redaction]);
            }
            return true;
        }
    }

    /**
     * Process the redaction queue, carrying out the action of each `QueuedRedaction` in sequence.
     * If a redaction cannot be processed, the redaction is skipped and removed from the queue.
     * We then carry on processing the next redactions.
     * The reason we skip is at the moment is that we would have to think about all of the situations
     * where we would not want failures to try again (e.g. messages were already redacted) and handle them explicitly.
     * @param client The matrix client to use for processing redactions.
     * @param limitToRoomId If the roomId is provided, only redactions for that room will be processed.
     * @returns A description of any errors encountered by each QueuedRedaction that was processed.
     */
    public async process(
        client: MatrixSendClient,
        managementRoom: ManagementRoomOutput,
        limitToRoomId?: string,
    ): Promise<RoomUpdateError[]> {
        const errors: RoomUpdateError[] = [];

        // Take everything we're going to process off the queue first, so that redactions for the
        // same user in different rooms can be batched together below.
        const batch: QueuedRedaction[] = [];
        if (limitToRoomId) {
            // There might not actually be any queued redactions for this room.
            let queuedRedactions = this.toRedact.get(limitToRoomId);
            if (queuedRedactions) {
                this.toRedact.delete(limitToRoomId);
                batch.push(...queuedRedactions);
            }
        } else {
            for (const [roomId, redactions] of this.toRedact) {
                this.toRedact.delete(roomId);
                batch.push(...redactions);
            }
        }

        // The admin API redacts a user across a list of rooms in one task so issue a
        // single request per user rather than one per room.
        const adminRedactions = new Map<string, RedactUserInRoom[]>();
        const remaining: QueuedRedaction[] = [];
        for (const redaction of batch) {
            if (redaction instanceof RedactUserInRoom && redaction.isBatchableByAdminApi) {
                const entry = adminRedactions.get(redaction.userId);
                if (entry) {
                    entry.push(redaction);
                } else {
                    adminRedactions.set(redaction.userId, [redaction]);
                }
            } else {
                remaining.push(redaction);
            }
        }

        for (const [userId, redactions] of adminRedactions) {
            const roomIds = redactions.map((r) => r.roomId);
            try {
                await managementRoom.logMessage(
                    LogLevel.DEBUG,
                    "Mjolnir",
                    `Redacting events from ${userId} in rooms ${roomIds.join(", ")}.`,
                );
                await redactUserMessagesIn(client, managementRoom, userId, roomIds, true);
            } catch (e) {
                // We can't tell which room(s) the batch failed for, so report the error against each.
                errors.push(...roomIds.map((roomId) => redactionError(e, roomId)));
            }
        }

        for (const redaction of remaining) {
            try {
                await redaction.redact(client, managementRoom);
            } catch (e) {
                errors.push(redactionError(e, redaction.roomId));
            }
        }

        return errors;
    }
}

function redactionError(e: any, roomId: string): RoomUpdateError {
    if (e.roomId && e.errorMessage && e.errorKind) {
        return e;
    }
    const message = e.message || (e.body ? e.body.error : "<no message>");
    return {
        roomId,
        errorMessage: message,
        errorKind: ERROR_KIND_FATAL,
    };
}
