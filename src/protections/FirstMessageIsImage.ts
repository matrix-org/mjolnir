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

export class FirstMessageIsImage implements IProtection {

    public justJoined: { [roomId: string]: string[] } = {};

    constructor() {
    }

    public get name(): string {
        return 'FirstMessageIsImageProtection';
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (!this.justJoined[roomId]) this.justJoined[roomId] = [];

        if (event['type'] === 'm.room.member') {
            const membership = event['content']['membership'] || 'join';
            let prevMembership = "leave";
            if (event['unsigned'] && event['unsigned']['prev_content']) {
                prevMembership = event['unsigned']['prev_content']['membership'] || 'leave';
            }

            // We look at the previous membership to filter out profile changes
            if (membership === 'join' && prevMembership !== "join") {
                this.justJoined[roomId].push(event['state_key']);
                LogService.info("FirstMessageIsImage", `Tracking ${event['state_key']} in ${roomId} as just joined`);
            }

            return; // stop processing (membership event spam is another problem)
        }

        if (event['type'] === 'm.room.message') {
            const content = event['content'] || {};
            const msgtype = content['msgtype'] || 'm.text';
            const formattedBody = content['formatted_body'] || '';
            const isMedia = msgtype === 'm.image' || msgtype === 'm.video' || formattedBody.toLowerCase().includes('<img');
            if (isMedia && this.justJoined[roomId].includes(event['sender'])) {
                await logMessage(LogLevel.WARN, "FirstMessageIsImage", `Banning ${event['sender']} for posting an image as the first thing after joining.`);
                await mjolnir.client.banUser(event['sender'], roomId, "spam");
                await mjolnir.client.redactEvent(roomId, event['event_id'], "spam");
            }
        }

        const idx = this.justJoined[roomId].indexOf(event['sender']);
        if (idx >= 0) {
            LogService.info("FirstMessageIsImage", `${event['sender']} is no longer considered suspect`);
            this.justJoined[roomId].splice(idx, 1);
        }
    }
}
