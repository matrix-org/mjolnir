/*
Copyright 2020 Emi Tatsuo Simpson et al.
Copyright 2022 Marcel Radzio

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

const LOCALPART_REGEX = "[0-9a-z-.=_/]+";
// https://github.com/johno/domain-regex/blob/8a6984c8fa1fe8481a4b99be0fa7f2a01ee17517/index.js
const DOMAIN_REGEX = "(\b((?=[a-z0-9-]{1,63}\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,63}\b)";
// https://stackoverflow.com/a/5284410
const IPV4_REGEX = "(((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))";
// https://stackoverflow.com/a/17871737
const IPV6_REGEX = "(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))";
const PORT_REGEX = "(:[0-9]+)?";


export class MentionFlood implements IProtection {

    settings = {};

    private justJoined: { [roomId: string]: { [username: string]: Date; }; } = {};
    private mention: RegExp;

    constructor() {
        this.mention = new RegExp(`@${LOCALPART_REGEX}:(${DOMAIN_REGEX}|${IPV4_REGEX}|${IPV6_REGEX})${PORT_REGEX}`, "g");
    }

    public get name(): string {
        return 'MentionFlood';
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {

        const content = event['content'] || {};
        const minsBeforeTrusting = config.protections.mentionFlood.minutesBeforeTrusting;

        if (minsBeforeTrusting > 0) {
            if (!this.justJoined[roomId]) this.justJoined[roomId] = {};

            // When a new member logs in, store the time they joined.  This will be useful
            // when we need to check if a message was sent within 20 minutes of joining
            if (event['type'] === 'm.room.member') {
                if (isTrueJoinEvent(event)) {
                    const now = new Date();
                    this.justJoined[roomId][event['state_key']] = now;
                    LogService.info("MentionFlood", `${event['state_key']} joined ${roomId} at ${now.toDateString()}`);
                } else if (content['membership'] === 'leave' || content['membership'] === 'ban') {
                    delete this.justJoined[roomId][event['sender']];
                }

                return;
            }
        }

        if (event['type'] === 'm.room.message') {
            const message = content['formatted_body'] || content['body'] || null;

            // Check conditions first
            if (minsBeforeTrusting > 0) {
                const joinTime = this.justJoined[roomId][event['sender']];
                if (joinTime) { // Disregard if the user isn't recently joined

                    // Check if they did join recently, was it within the timeframe
                    const now = new Date();
                    if (now.valueOf() - joinTime.valueOf() > minsBeforeTrusting * 60 * 1000) {
                        delete this.justJoined[roomId][event['sender']]; // Remove the user
                        LogService.info("MentionFlood", `${event['sender']} is no longer considered suspect`);
                        return;
                    }

                } else {
                    // The user isn't in the recently joined users list, no need to keep
                    // looking
                    return;
                }
            }


            // Perform the test
            const maxMentionsPerMessage = config.protections.mentionFlood.maxMentionsPerMessage;
            if (message && message.match(this.mention).length > maxMentionsPerMessage) {
                await logMessage(LogLevel.WARN, "MentionFlood", `Banning ${event['sender']} for mention flood violation in ${roomId}.`);
                if (!config.noop) {
                    await mjolnir.client.banUser(event['sender'], roomId, "Mention Flood violation");
                } else {
                    await logMessage(LogLevel.WARN, "MentionFlood", `Tried to ban ${event['sender']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }

                // Redact the event
                if (!config.noop) {
                    await mjolnir.client.redactEvent(roomId, event['event_id'], "spam");
                } else {
                    await logMessage(LogLevel.WARN, "MentionFlood", `Tried to redact ${event['event_id']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }
            }
        }
    }
}
