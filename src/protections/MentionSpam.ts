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
import { LRUCache } from "lru-cache";

export const DEFAULT_MAX_MENTIONS = 10;

export class MentionSpam extends Protection {

    private roomDisplaynameCache = new LRUCache<string, string[]>({
        ttl: 1000 * 60 * 24, // 24 minutes
        ttlAutopurge: true,
    });

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

    private async getRoomDisplaynames(mjolnir: Mjolnir, roomId: string): Promise<string[]> {
        const existing = this.roomDisplaynameCache.get(roomId);
        if (existing) {
            return existing;
        }
        const profiles = await mjolnir.client.getJoinedRoomMembersWithProfiles(roomId);
        const displaynames = (Object.values(profiles)
            .map(v => v.display_name?.toLowerCase())
            .filter(v => typeof v === "string") as string[])
            // Limit to displaynames with more than a few characters.
            .filter(displayname => displayname.length > 2);

        this.roomDisplaynameCache.set(roomId, displaynames);
        return displaynames;
    }

    public checkMentions(body: unknown|undefined, htmlBody: unknown|undefined, mentionArray: unknown|undefined): boolean {
        const max = this.settings.maxMentions.value;
        if (Array.isArray(mentionArray) && mentionArray.length > max) {
            return true;
        }
        if (typeof body === "string" && body.split('@').length - 1 > max) {
            return true;
        }
        if (typeof htmlBody === "string" && htmlBody.split('%40').length - 1 > max) {
            return true;
        }
        return false;
    }

    public checkDisplaynameMentions(body: unknown|undefined, htmlBody: unknown|undefined, displaynames: string[]): boolean {
        const max = this.settings.maxMentions.value;
        const bodyWords = ((typeof body === "string" && body) || "").toLowerCase();
        if (displaynames.filter(s => bodyWords.includes(s.toLowerCase())).length > max) {
            return true;
        }
        const htmlBodyWords = decodeURIComponent((typeof htmlBody === "string" && htmlBody) || "").toLowerCase();
        if (displaynames.filter(s => htmlBodyWords.includes(s)).length > max) {
            return true;
        }
        return false;
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event['type'] === 'm.room.message') {
            let content = event['content'] || {};
            const explicitMentions = content["m.mentions"]?.user_ids;
            let hitLimit = this.checkMentions(content.body, content.formatted_body, explicitMentions);

            // Slightly more costly to hit displaynames, so only do it if we don't hit on mxid matches.
            if (!hitLimit) {
                const displaynames = await this.getRoomDisplaynames(mjolnir, roomId);
                hitLimit = this.checkDisplaynameMentions(content.body, content.formatted_body, displaynames);
            }

            if (hitLimit) {
                await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionSpam", `Redacting event from ${event['sender']} for spamming mentions. ${Permalinks.forEvent(roomId, event['event_id'], [new UserID(await mjolnir.client.getUserId()).domain])}`);
                // Redact the event
                if (!mjolnir.config.noop) {
                    await mjolnir.client.redactEvent(roomId, event['event_id'], "Message was detected as spam.");
                    mjolnir.unlistedUserRedactionHandler.addUser(event['sender']);
                } else {
                    await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionSpam", `Tried to redact ${event['event_id']} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                }
            }
        }
    }
}
