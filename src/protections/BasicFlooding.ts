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
import { NumberProtectionSetting } from "./ProtectionSettings";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, LogService } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import config from "../config";

// if this is exceeded, we'll ban the user for spam and redact their messages
export const DEFAULT_MAX_PER_MINUTE = 10;
const TIMESTAMP_THRESHOLD = 30000; // 30s out of phase

export class BasicFlooding implements IProtection {

    private lastEvents: { [roomId: string]: { [userId: string]: { originServerTs: number, eventId: string }[] } } = {};
    private recentlyBanned: string[] = [];

    maxPerMinute = new NumberProtectionSetting(DEFAULT_MAX_PER_MINUTE);
    settings = {};

    constructor() {
        this.settings['maxPerMinute'] = this.maxPerMinute;
    }

    public get name(): string {
        return 'BasicFloodingProtection';
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (!this.lastEvents[roomId]) this.lastEvents[roomId] = {};

        const forRoom = this.lastEvents[roomId];
        if (!forRoom[event['sender']]) forRoom[event['sender']] = [];
        let forUser = forRoom[event['sender']];

        if ((new Date()).getTime() - event['origin_server_ts'] > TIMESTAMP_THRESHOLD) {
            LogService.warn("BasicFlooding", `${event['event_id']} is more than ${TIMESTAMP_THRESHOLD}ms out of phase - rewriting event time to be 'now'`);
            event['origin_server_ts'] = (new Date()).getTime();
        }

        forUser.push({originServerTs: event['origin_server_ts'], eventId: event['event_id']});

        // Do some math to see if the user is spamming
        let messageCount = 0;
        for (const prevEvent of forUser) {
            if ((new Date()).getTime() - prevEvent.originServerTs > 60000) continue; // not important
            messageCount++;
        }

        if (messageCount >= this.maxPerMinute.value) {
            await logMessage(LogLevel.WARN, "BasicFlooding", `Banning ${event['sender']} in ${roomId} for flooding (${messageCount} messages in the last minute)`, roomId);
            if (!config.noop) {
                await mjolnir.client.banUser(event['sender'], roomId, "spam");
            } else {
                await logMessage(LogLevel.WARN, "BasicFlooding", `Tried to ban ${event['sender']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
            }

            if (this.recentlyBanned.includes(event['sender'])) return; // already handled (will be redacted)
            mjolnir.unlistedUserRedactionHandler.addUser(event['sender']);
            this.recentlyBanned.push(event['sender']); // flag to reduce spam

            // Redact all the things the user said too
            if (!config.noop) {
                for (const eventId of forUser.map(e => e.eventId)) {
                    await mjolnir.client.redactEvent(roomId, eventId, "spam");
                }
            } else {
                await logMessage(LogLevel.WARN, "BasicFlooding", `Tried to redact messages for ${event['sender']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
            }

            // Free up some memory now that we're ready to handle it elsewhere
            forUser = forRoom[event['sender']] = []; // reset the user's list
        }

        // Trim the oldest messages off the user's history if it's getting large
        if (forUser.length > this.maxPerMinute.value * 2) {
            forUser.splice(0, forUser.length - (this.maxPerMinute.value * 2) - 1);
        }
    }
}
