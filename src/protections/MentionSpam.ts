/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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
import { LogLevel, Permalinks, UserID } from "@vector-im/matrix-bot-sdk";
import { NumberProtectionSetting } from "./ProtectionSettings";

export const DEFAULT_MAX_MENTIONS = 10;
const USER_ID_REGEX = /@[^:]*:.+/;

export class MentionSpam extends Protection {

    settings = {
        maxMentions: new NumberProtectionSetting(DEFAULT_MAX_MENTIONS, 1),
    };

    constructor() {
        super();
    }

    public get name(): string {
        return 'MentionSpam';
    }
    public get description(): string {
        return "If a user posts many mentions, that message is redacted. No bans are issued.";
    }

    public checkMentions(body: unknown|undefined, htmlBody: unknown|undefined, mentionArray: unknown|undefined): boolean {
        const max = this.settings.maxMentions.value;
        if (Array.isArray(mentionArray)) {
            if (mentionArray.length > this.settings.maxMentions.value) {
                return true;
            }
        }
        if (typeof body === "string") {
            let found = 0;
            for (const word of body.split(/\s/)) {
                if (USER_ID_REGEX.test(word.trim())) {
                    if (++found > max) {
                        return true;
                    }
                }
            }
        }
        if (typeof htmlBody === "string") {
            let found = 0;
            for (const word of htmlBody.split(/\s/)) {
                if (USER_ID_REGEX.test(word.trim())) {
                    if (++found > max) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event['type'] === 'm.room.message') {
            let content = event['content'] || {};
            const explicitMentions = content["m.mentions"]?.["m.user_ids"];
            const hitLimit = this.checkMentions(content.body, content.formatted_body, explicitMentions);
            if (hitLimit) {
                await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionSpam", `Redacting event from ${event['sender']} for spamming mentions. ${Permalinks.forEvent(roomId, event['event_id'], [new UserID(await mjolnir.client.getUserId()).domain])}`);
                // Redact the event
                if (!mjolnir.config.noop) {
                    await mjolnir.client.redactEvent(roomId, event['event_id'], "Message was detected as spam.");
                } else {
                    await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionSpam", `Tried to redact ${event['event_id']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }
            }
        }
    }
}
