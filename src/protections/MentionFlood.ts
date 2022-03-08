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

import { Protection } from "./IProtection";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, LogService } from "matrix-bot-sdk";
import config from "../config";
import { htmlEscape } from "../utils";
import { BooleanProtectionSetting, DurationMSProtectionSetting, NumberProtectionSetting, OptionListProtectionSetting } from "./ProtectionSettings";

const DEFAULT_MINUTES_BEFORE_TRUSTING = 20 * 60 * 1000;
const DEFAULT_MAX_MENTIONS_PER_MESSAGE = 20;
const DEFAULT_REDACT = true;
const DEFAULT_ACTION = "ban";

const LOCALPART_REGEX = "[0-9a-z-.=_/]+";
// https://github.com/johno/domain-regex/blob/8a6984c8fa1fe8481a4b99be0fa7f2a01ee17517/index.js
const DOMAIN_REGEX = "(\\b((?=[a-z0-9-]{1,63}\\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\\.)+[a-z]{2,63}\\b)";
// https://stackoverflow.com/a/5284410
const IPV4_REGEX = "(((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))";
// https://stackoverflow.com/a/17871737
const IPV6_REGEX = "(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))";
const PORT_REGEX = "(:[0-9]+)?";


export class MentionFlood extends Protection {

    settings = {
        // Time in which this protection takes action on users
        minutesBeforeTrusting: new DurationMSProtectionSetting(DEFAULT_MINUTES_BEFORE_TRUSTING),
        // The minimum amount of mentions for this protection to take action
        maxMentionsPerMessage: new NumberProtectionSetting(DEFAULT_MAX_MENTIONS_PER_MESSAGE),
        // Defines if messages shall also get directly redacted or not
        redact: new BooleanProtectionSetting(DEFAULT_REDACT),
        // The action that is supposed to get taken
        action: new OptionListProtectionSetting(["ban", "kick", "warn"])
    };

    private mention: RegExp;

    constructor() {
        super();
        this.mention = new RegExp(`@${LOCALPART_REGEX}:(${DOMAIN_REGEX}|${IPV4_REGEX}|${IPV6_REGEX})${PORT_REGEX}`, "gi");
    }

    public get name(): string {
        return 'MentionFlood';
    }

    public get description(): string {
        return `Protects against recently joined users attempting to ping too many other users at the same time. 
        This will not publish bans to the ban list.`;
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        const content = event['content'] || {};
        const minsBeforeTrusting = this.settings.minutesBeforeTrusting.value;

        if (event['type'] === 'm.room.message') {
            const message: string = content['formatted_body'] || content['body'] || "";

            // Check conditions first
            if (minsBeforeTrusting > 0) {
                const joinTime = mjolnir.roomJoins.getUserJoin({ roomId: roomId, userId: event['sender'] });
                // If we know the user and have its time we check if.
                // Otherwise we assume a bug and still mark them as suspect just to make sure.
                if (joinTime) {

                    // Check if they did join recently, was it within the timeframe
                    const now = Date.now();
                    if (now.valueOf() - joinTime.valueOf() > minsBeforeTrusting) {
                        LogService.info("MentionFlood", `${htmlEscape(event['sender'])} is no longer considered suspect`);
                        return;
                    }

                }
            }


            // Perform the test
            const maxMentionsPerMessage = this.settings.maxMentionsPerMessage.value;
            if (message && (message.match(this.mention)?.length || 0) > maxMentionsPerMessage) {
                const action = this.settings.action.value !== "" ? this.settings.action.value : DEFAULT_ACTION;
                switch (action) {
                    case "ban": {
                        await mjolnir.logMessage(LogLevel.WARN, "MentionFlood", `Banning ${htmlEscape(event['sender'])} for mention flood violation in ${roomId}.`);
                        if (!config.noop) {
                            await mjolnir.client.banUser(event['sender'], roomId, "Mention Flood violation");
                        } else {
                            await mjolnir.logMessage(LogLevel.WARN, "MentionFlood", `Tried to ban ${htmlEscape(event['sender'])} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                        }
                        break;
                    }
                    case "kick": {
                        await mjolnir.logMessage(LogLevel.WARN, "MentionFlood", `Kicking ${htmlEscape(event['sender'])} for mention flood violation in ${roomId}.`);
                        if (!config.noop) {
                            await mjolnir.client.kickUser(event['sender'], roomId, "Mention Flood violation");
                        } else {
                            await mjolnir.logMessage(LogLevel.WARN, "MentionFlood", `Tried to kick ${htmlEscape(event['sender'])} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                        }
                        break;
                    }
                    case "warn": {
                        await mjolnir.logMessage(LogLevel.WARN, "MentionFlood", `${htmlEscape(event['sender'])} triggered the mention flood protection in ${roomId}.`);
                        break;
                    }
                }


                // Redact the event
                if (!config.noop && this.settings.redact.value) {
                    await mjolnir.client.redactEvent(roomId, event['event_id'], "spam");
                } else {
                    await mjolnir.logMessage(LogLevel.WARN, "MentionFlood", `Tried to redact ${htmlEscape(event['event_id'])} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }
            }
        }
    }
}
