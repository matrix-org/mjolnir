/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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

export const MAX_PER_MINUTE = 10; // if this is exceeded, we'll ban the user for spam and redact their messages
const TIMESTAMP_THRESHOLD = 30000; // 30s out of phase

export class BasicFlooding implements IProtection {

    public lastEvents: { [roomId: string]: { [userId: string]: { originServerTs: number, eventId: string }[] } } = {};

    constructor() {
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

        if (messageCount >= MAX_PER_MINUTE) {
            await logMessage(LogLevel.WARN, "BasicFlooding", `Banning ${event['sender']} in ${roomId} for flooding (${messageCount} messages in the last minute)`);
            await mjolnir.client.banUser(event['sender'], roomId, "spam");
            // Redact all the things the user said too
            for (const eventId of forUser.map(e => e.eventId)) {
                await mjolnir.client.redactEvent(roomId, eventId, "spam");
            }
            forUser = forRoom[event['sender']] = []; // reset the user's list
        }

        // Trim the oldest messages off the user's history if it's getting large
        if (forUser.length > MAX_PER_MINUTE * 2) {
            forUser.splice(0, forUser.length - (MAX_PER_MINUTE * 2) - 1);
        }
    }
}
