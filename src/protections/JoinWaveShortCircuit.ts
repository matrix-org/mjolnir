/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import {Protection} from "./IProtection";
import {Mjolnir} from "../Mjolnir";
import {NumberProtectionSetting} from "./ProtectionSettings";
import {LogLevel} from "matrix-bot-sdk";
import config from "../config";

export const DEFAULT_MAX_PER_HOUR = 50;
const ONE_HOUR = 3600_000; // 1h in ms

export class JoinWaveShortCircuit extends Protection {
    requiredStatePermissions = ["m.room.join_rules"]

    private joinBuckets: {
        [roomId: string]: {
            lastBucketStart: Date,
            numberOfJoins: number,
        }
    } = {};

    settings = {
        maxPerHour: new NumberProtectionSetting(DEFAULT_MAX_PER_HOUR)
    };

    constructor() {
        super();
    }

    public get name(): string {
        return "JoinWaveShortCircuit";
    }

    public get description(): string {
        return "If X amount of users join in Y time, set the room to invite-only."
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any) {
        if (event['type'] !== 'm.room.member') {
            // Not a join/leave event.
            return;
        }

        if (!(roomId in mjolnir.protectedRooms)) {
            // Not a room we are watching.
            return;
        }

        const userId = event['state_key'];
        if (!userId) {
            // Ill-formed event.
            return;
        }

        const userState = event['content']['membership'];
        const prevMembership = event['unsigned']?.['prev_content']?.['membership'] || "leave";

        // We look at the previous membership to filter out profile changes
        if (userState === 'join' && prevMembership !== "join") {
            // A new join, fallthrough
        } else {
            return;
        }

        // If either the roomId bucket didn't exist, or the bucket has expired, create a new one
        if (!this.joinBuckets[roomId] || JoinWaveShortCircuit.hasExpired(this.joinBuckets[roomId].lastBucketStart)) {
            this.joinBuckets[roomId] = {
                lastBucketStart: new Date(),
                numberOfJoins: 0
            }
        }

        if (++this.joinBuckets[roomId].numberOfJoins >= this.settings.maxPerHour.value) {
            await mjolnir.logMessage(LogLevel.WARN, "JoinWaveShortCircuit", `Setting ${roomId} to invite-only as more than ${this.settings.maxPerHour.value} users have joined over the last hour (since ${this.joinBuckets[roomId].lastBucketStart})`, roomId);

            if (!config.noop) {
                await mjolnir.client.sendStateEvent(roomId, "m.room.join_rules", "", {"join_rule": "invite"})
            } else {
                await mjolnir.logMessage(LogLevel.WARN, "BasicFlooding", `Tried to set ${roomId} to invite-only, but Mjolnir is running in no-op mode`, roomId);
            }
        }
    }

    private static hasExpired(at: Date): boolean {
        return ((new Date()).getTime() - at.getTime()) > ONE_HOUR
    }

    public async statusCommand(mjolnir: Mjolnir, subcommand: string[]): Promise<{ html: string, text: string }> {
        const withExpired = subcommand.includes("withExpired");
        const withStart = subcommand.includes("withStart");

        let html = `<b>Short Circuit join buckets (max ${this.settings.maxPerHour.value} per hour):</b><br/><ul>`;
        let text = `Short Circuit join buckets (max ${this.settings.maxPerHour.value} per hour):\n`;

        for (const roomId of Object.keys(this.joinBuckets)) {
            const bucket = this.joinBuckets[roomId];
            const isExpired = JoinWaveShortCircuit.hasExpired(bucket.lastBucketStart);

            if (isExpired && !withExpired) {
                continue;
            }

            const startText = withStart ? ` (since ${bucket.lastBucketStart})` : "";
            const expiredText = isExpired ? ` (bucket expired since ${new Date(bucket.lastBucketStart.getTime() + ONE_HOUR)})` : "";

            html += `<li><a href="https://matrix.to/#/${roomId}">${roomId}</a>: ${bucket.numberOfJoins} joins${startText}${expiredText}.</li>`;
            text += `* ${roomId}: ${bucket.numberOfJoins} joins${startText}${expiredText}.\n`;
        }

        html += "</ul>";

        return {
            html,
            text,
        }
    }
}
