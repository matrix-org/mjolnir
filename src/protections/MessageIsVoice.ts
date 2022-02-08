/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

import { Protection } from "./IProtection";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, Permalinks, UserID } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import config from "../config";

export class MessageIsVoice extends Protection {

    settings = {};

    constructor() {
        super();
    }

    public get name(): string {
        return 'MessageIsVoiceProtection';
    }
    public get description(): string {
        return "If a user posts a voice message, that message will be redacted. No bans are issued.";
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event['type'] === 'm.room.message' && event['content']) {
            if (event['content']['msgtype'] !== 'm.audio') return;
            if (event['content']['org.matrix.msc3245.voice'] === undefined) return;
            await logMessage(LogLevel.INFO, "MessageIsVoice", `Redacting event from ${event['sender']} for posting a voice message. ${Permalinks.forEvent(roomId, event['event_id'], [new UserID(await mjolnir.client.getUserId()).domain])}`);
            // Redact the event
            if (!config.noop) {
                await mjolnir.client.redactEvent(roomId, event['event_id'], "Voice messages are not permitted here");
            } else {
                await logMessage(LogLevel.WARN, "MessageIsVoice", `Tried to redact ${event['event_id']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
            }
        }
    }
}
