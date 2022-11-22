/*
Copyright 2020 Emi Tatsuo Simpson et al.

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
import { ConsequenceBan, ConsequenceRedact } from "./consequence";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, LogService } from "matrix-bot-sdk";
import { isTrueJoinEvent } from "../utils";

export class WordList extends Protection {

    settings = {};

    private justJoined: { [roomId: string]: { [username: string]: Date} } = {};
    private badWords?: RegExp;

    constructor() {
        super();
    }

    public get name(): string {
        return 'WordList';
    }
    public get description(): string {
        return "If a user posts a monitored word a set amount of time after joining, they " +
            "will be banned from that room.  This will not publish the ban to a ban list.";
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {

        const content = event['content'] || {};
        const minsBeforeTrusting = mjolnir.config.protections.wordlist.minutesBeforeTrusting;

        if (minsBeforeTrusting > 0) {
            if (!this.justJoined[roomId]) this.justJoined[roomId] = {};

            // When a new member logs in, store the time they joined.  This will be useful
            // when we need to check if a message was sent within 20 minutes of joining
            if (event['type'] === 'm.room.member') {
                if (isTrueJoinEvent(event)) {
                    const now = new Date();
                    this.justJoined[roomId][event['state_key']] = now;
                    LogService.info("WordList", `${event['state_key']} joined ${roomId} at ${now.toDateString()}`);
                } else if (content['membership'] === 'leave' || content['membership'] === 'ban') {
                    delete this.justJoined[roomId][event['sender']]
                }

                return;
            }
        }

        if (event['type'] === 'm.room.message') {
            const message = content['formatted_body'] || content['body'] || null;
            if (!message) {
                return;
            }

            // Check conditions first
            if (minsBeforeTrusting > 0) {
                const joinTime = this.justJoined[roomId][event['sender']]
                if (joinTime) { // Disregard if the user isn't recently joined

                    // Check if they did join recently, was it within the timeframe
                    const now = new Date();
                    if (now.valueOf() - joinTime.valueOf() > minsBeforeTrusting * 60 * 1000) {
                        delete this.justJoined[roomId][event['sender']] // Remove the user
                        LogService.info("WordList", `${event['sender']} is no longer considered suspect`);
                        return
                    }

                } else {
                    // The user isn't in the recently joined users list, no need to keep
                    // looking
                    return
                }
            }
            if (!this.badWords) {
                // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
                const escapeRegExp = (string: string) => {
                    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                };

                // Create a mega-regex from all the tiny words.
                const words = mjolnir.config.protections.wordlist.words.filter(word => word.length !== 0).map(escapeRegExp);
                if (words.length === 0) {
                    mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, "WordList", `Someone turned on the word list protection without configuring any words. Disabling.`);
                    this.enabled = false;
                    return;
                }
                this.badWords = new RegExp(words.join("|"), "i");
            }

            const match = this.badWords!.exec(message);
            if (match) {
                const reason = `bad word: ${match[0]}`;
                return [new ConsequenceBan(reason), new ConsequenceRedact(reason)];
            }
        }
    }
}
