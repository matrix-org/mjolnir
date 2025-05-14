/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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
import { LogLevel, LogService } from "@vector-im/matrix-bot-sdk";
import { htmlEscape, isTrueJoinEvent, findLink } from "../utils";
import { NumberProtectionSetting } from "./ProtectionSettings";

// how long a new join will remain in cache if no messages sent
const DEFAULT_JOIN_CACHE_EXPIRY_HOURS = 24;

export class FirstMessageIsLink extends Protection {
    private justJoined: { [roomId: string]: { ts: number; stateKey: string }[] } = {};
    private recentlyBanned: string[] = [];
    private cacheIntervalTimer: NodeJS.Timeout;

    settings = {
        joinCacheExpiryHours: new NumberProtectionSetting(DEFAULT_JOIN_CACHE_EXPIRY_HOURS),
    };

    constructor() {
        super();
        this.checkCache();
    }

    public get name(): string {
        return "FirstMessageIsLinkProtection";
    }
    public get description(): string {
        return (
            "If the first thing a user does after joining is to post a link, " +
            "they'll be banned for spam. This does not publish the ban to any of your ban lists."
        );
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (!this.justJoined[roomId]) this.justJoined[roomId] = [];

        if (event["type"] === "m.room.member") {
            if (isTrueJoinEvent(event)) {
                let join = {
                    ts: Date.now(),
                    stateKey: event["state_key"],
                };
                this.justJoined[roomId].push(join);
                LogService.info("FirstMessageIsLink", `Tracking ${event["state_key"]} in ${roomId} as just joined`);
            }

            return; // stop processing (membership event spam is another problem)
        }

        if (event["type"] === "m.room.message") {
            const content = event["content"] || {};
            const msgtype = content["msgtype"] || "m.text";
            let bodyHasLink = false;
            let formattedBodyHasLink = false;
            if (msgtype === "m.text") {
                bodyHasLink = findLink(event.content.body);
                formattedBodyHasLink = findLink(event.content.formattedBody);
            }

            const isLink = bodyHasLink || formattedBodyHasLink;
            if (isLink && this.justJoined[roomId].find((t) => t.stateKey === event["sender"])) {
                await mjolnir.client.sendMessage(mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `Banning ${event["sender"]} for posting a link as the first thing after joining in ${roomId}.`,
                    format: "org.matrix.custom.html",
                    formatted_body: `Banning <span data-mx-spoiler>${htmlEscape(event["sender"])}</span> for posting a link as the first thing after joining in ${roomId}.`,
                });
                if (!mjolnir.config.noop) {
                    if (mjolnir.moderators.checkMembership(event["sender"])) {
                        await mjolnir.managementRoomOutput.logMessage(
                            LogLevel.WARN,
                            "FirstMessageIsLink",
                            `Attempting to ban ${event["sender"]} but they are member of moderation room, aborting.`,
                        );
                        return;
                    }
                    await mjolnir.client.banUser(event["sender"], roomId, "spam");
                } else {
                    await mjolnir.managementRoomOutput.logMessage(
                        LogLevel.WARN,
                        "FirstMessageIsLink",
                        `Tried to ban ${event["sender"]} in ${roomId} but Mjolnir is running in no-op mode`,
                        roomId,
                    );
                }

                if (this.recentlyBanned.includes(event["sender"])) return; // already handled (will be redacted)
                mjolnir.unlistedUserRedactionHandler.addUser(event["sender"]);
                this.recentlyBanned.push(event["sender"]); // flag to reduce spam

                // Redact the event
                if (!mjolnir.config.noop) {
                    await mjolnir.client.redactEvent(roomId, event["event_id"], "spam");
                } else {
                    await mjolnir.managementRoomOutput.logMessage(
                        LogLevel.WARN,
                        "FirstMessageIsLink",
                        `Tried to redact ${event["event_id"]} in ${roomId} but Mjolnir is running in no-op mode`,
                        roomId,
                    );
                }
            }
        }

        const idx = this.justJoined[roomId].findIndex((t) => t.stateKey === event["sender"]);
        if (idx >= 0) {
            LogService.info("FirstMessageIsLink", `${event["sender"]} is no longer considered suspect`);
            this.justJoined[roomId].splice(idx, 1);
        }
    }
    // empty cache of expired joins
    private emptyCache() {
        const now = Date.now();
        const cacheExpiryValMs = 1000 * 60 * 60 * this.settings.joinCacheExpiryHours.value;
        for (const roomId in this.justJoined) {
            this.justJoined[roomId] = this.justJoined[roomId].filter((t) => now - t.ts >= cacheExpiryValMs);
        }
    }
    private checkCache() {
        this.cacheIntervalTimer = setInterval(() => this.emptyCache(), 1000 * 60 * 30); // check cache for expired joins every 30 mins
    }

    public stop() {
        clearInterval(this.cacheIntervalTimer);
    }
}
