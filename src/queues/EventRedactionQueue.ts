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
import { LogLevel, MatrixClient } from "matrix-bot-sdk"
import { ERROR_KIND_FATAL } from "../ErrorCache";
import { logMessage } from "../LogProxy";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { redactUserMessagesIn } from "../utils";

export interface QueuedRedaction {
    roomId: string; // The room which the redaction will take place in.
    redact(client: MatrixClient): Promise<any>
    redactionEqual(redaction: QueuedRedaction): boolean
    report(e: any): RoomUpdateError
}

export class RedactUserInRoom implements QueuedRedaction {
    userId: string;
    roomId: string;

    constructor(userId: string, roomId: string) {
        this.userId = userId;
        this.roomId = roomId;
    }

    public async redact(client: MatrixClient) {
        await logMessage(LogLevel.DEBUG, "Mjolnir", `Redacting events from ${this.userId} in room ${this.roomId}.`);
        await redactUserMessagesIn(client, this.userId, [this.roomId]);
    }

    public redactionEqual(redaction: QueuedRedaction): boolean {
        if (redaction instanceof RedactUserInRoom) {
            return redaction.userId === this.userId && redaction.roomId === this.roomId;
        } else {
            return false;
        }
    }

    public report(e): RoomUpdateError {
        const message = e.message || (e.body ? e.body.error : '<no message>');
        return {
            roomId: this.roomId,
            errorMessage: message,
            errorKind: ERROR_KIND_FATAL,
        };
    }
}
/**
 * This is a queue for events so that other protections can happen first (e.g. applying room bans to every room).
 */
export class EventRedactionQueue {
    private toRedact: Array<QueuedRedaction> = new Array<QueuedRedaction>();

    public has(redaction: QueuedRedaction) {
        return this.toRedact.find(r => r.redactionEqual(redaction));
    }

    public add(redaction: QueuedRedaction) {
        if (this.has(redaction)) {
            return;
        } else {
            this.toRedact.push(redaction);
        }
    }

    public delete(redaction: QueuedRedaction) {
        this.toRedact = this.toRedact.filter(r => r.redactionEqual(redaction));
    }

    /**
     * Process the redaction queue, carrying out the action of each QueuedRedaction in sequence.
     * @param client The matrix client to use for processing redactions.
     * @param roomId If the roomId is provided, only redactions for that room will be processed.
     * @returns A description of any errors encountered by each QueuedRedaction that was processed.
     */
    public async process(client: MatrixClient, roomId?: string): Promise<RoomUpdateError[]> {
        const errors: RoomUpdateError[] = [];
        const currentBatch = roomId ? this.toRedact.filter(r => r.roomId === roomId) : this.toRedact;
        for (const redaction of currentBatch) {
            try {
                await redaction.redact(client);
            } catch (e) {
                errors.push(redaction.report(e));
            } finally {
                // We need to figure out in which circumstances we want to retry here.
                this.delete(redaction);
            }
        }
        return errors;
    }
}