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
//// NOTE: This is a queue for events so that other protections can happen first (bans and ACL)

import { LogLevel, MatrixClient } from "matrix-bot-sdk"
import { ERROR_KIND_FATAL } from "../ErrorCache";
import { logMessage } from "../LogProxy";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { redactUserMessagesIn } from "../utils";

export interface QueuedRedaction {
    redact(client: MatrixClient): Promise<any>
    redactionEqual(redaction: QueuedRedaction): boolean
    report(e): RoomUpdateError
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

    public async process(client: MatrixClient): Promise<RoomUpdateError[]> {
        const errors: RoomUpdateError[]= [];
        // need to change this so it pops the array until empty
        // otherwise this will be cringe.
        for (const redaction of this.toRedact) {
            try {
                await redaction.redact(client);
            } catch (e) {
                errors.push(redaction.report(e));
            } finally {
                // FIXME: Need to figure out in which circumstances we want to retry.
                this.delete(redaction);
            }
        }
        return errors;
    } 
}