/*
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.

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

import { IProtection } from "./IProtection";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, LogService } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import config from "../config";
import { isTrueJoinEvent } from "../utils";

export class WordList implements IProtection {

    private justJoined: { [roomId: string]: { [username: string]: Date} } = {};
    private badWords: RegExp = new RegExp(/.*(poopyhead).*/i)

    constructor() {
    }

    public get name(): string {
        return 'WordList';
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (!this.justJoined[roomId]) this.justJoined[roomId] = {};

        const content = event['content'] || {};

        // When a new member logs in, store the time they joined.  This will be useful
        // when we need to check if a message was sent within 20 minutes of joining
        if (event['type'] === 'm.room.member') {
            if (isTrueJoinEvent(event)) {
                const now = new Date();
                this.justJoined[roomId][event['state_key']] = now;
                LogService.info("WordList", `${event['state_key']} joined ${roomId} at ${now.toDateString()}`);
            } else if (content['membership'] == 'leave' || content['membership'] == 'ban') {
                delete this.justJoined[roomId][event['sender']]
            }

            return; // stop processing (membership event spam is another problem)
        }

        if (event['type'] === 'm.room.message') {
            const message = content['formatted_body'] || content['body'] || null;

            const joinTime = this.justJoined[roomId][event['sender']]
            if (joinTime) { // Disregard if the user isn't recently joined

                // Check if they did join recently, was it within 20 minutes
                const now = new Date();
                if (now.valueOf() - joinTime.valueOf() > 20 * 60 * 1000) {
                    delete this.justJoined[roomId][event['sender']] // Remove the user
                    LogService.info("WordList", `${event['sender']} is no longer considered suspect`);
                    return
                }

                // Perform the test
                if (message && this.badWords.test(message)) {
                    await logMessage(LogLevel.WARN, "WordList", `Banning ${event['sender']} for word list violation in ${roomId}.`);
                    if (!config.noop) {
                        await mjolnir.client.banUser(event['sender'], roomId, "Word list violation");
                    } else {
                        await logMessage(LogLevel.WARN, "WordList", `Tried to ban ${event['sender']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                    }

                    // Redact the event
                    if (!config.noop) {
                        await mjolnir.client.redactEvent(roomId, event['event_id'], "spam");
                    } else {
                        await logMessage(LogLevel.WARN, "WordList", `Tried to redact ${event['event_id']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                    }
                }
            }
        }
    }
}
