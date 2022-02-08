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

import { Protection } from "./IProtection";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, LogService } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import config from "../config";
import { isTrueJoinEvent } from "../utils";

export class FirstMessageIsImage extends Protection {

    private justJoined: { [roomId: string]: string[] } = {};
    private recentlyBanned: string[] = [];

    settings = {};

    constructor() {
        super();
    }

    public get name(): string {
        return 'FirstMessageIsImageProtection';
    }
    public get description(): string {
        return "If the first thing a user does after joining is to post an image or video, " +
            "they'll be banned for spam. This does not publish the ban to any of your ban lists.";
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (!this.justJoined[roomId]) this.justJoined[roomId] = [];

        if (event['type'] === 'm.room.member') {
            if (isTrueJoinEvent(event)) {
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
                await logMessage(LogLevel.WARN, "FirstMessageIsImage", `Banning ${event['sender']} for posting an image as the first thing after joining in ${roomId}.`);
                if (!config.noop) {
                    await mjolnir.client.banUser(event['sender'], roomId, "spam");
                } else {
                    await logMessage(LogLevel.WARN, "FirstMessageIsImage", `Tried to ban ${event['sender']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }

                if (this.recentlyBanned.includes(event['sender'])) return; // already handled (will be redacted)
                mjolnir.unlistedUserRedactionHandler.addUser(event['sender']);
                this.recentlyBanned.push(event['sender']); // flag to reduce spam

                // Redact the event
                if (!config.noop) {
                    await mjolnir.client.redactEvent(roomId, event['event_id'], "spam");
                } else {
                    await logMessage(LogLevel.WARN, "FirstMessageIsImage", `Tried to redact ${event['event_id']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }
            }
        }

        const idx = this.justJoined[roomId].indexOf(event['sender']);
        if (idx >= 0) {
            LogService.info("FirstMessageIsImage", `${event['sender']} is no longer considered suspect`);
            this.justJoined[roomId].splice(idx, 1);
        }
    }
}
