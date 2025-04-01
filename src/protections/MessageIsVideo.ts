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
import { LogLevel, Permalinks, UserID } from "@vector-im/matrix-bot-sdk";

export class MessageIsVideo extends Protection {
    settings = {};

    constructor() {
        super();
    }

    public get name(): string {
        return "MessageIsVideoProtection";
    }
    public get description(): string {
        return "If a user posts a video, that message will be redacted. No bans are issued.";
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event["type"] === "m.room.message") {
            let content = event["content"] || {};
            const relation = content["m.relates_to"];
            if (relation?.["rel_type"] === "m.replace") {
                content = content?.["m.new_content"] ?? content;
            }
            const msgtype = content["msgtype"] || "m.text";
            const isVideo = msgtype === "m.video";
            if (isVideo) {
                await mjolnir.managementRoomOutput.logMessage(
                    LogLevel.WARN,
                    "MessageIsVideo",
                    `Redacting event from ${event["sender"]} for posting an video. ${Permalinks.forEvent(roomId, event["event_id"], [new UserID(await mjolnir.client.getUserId()).domain])}`,
                );
                // Redact the event
                if (!mjolnir.config.noop) {
                    await mjolnir.client.redactEvent(roomId, event["event_id"], "Videos are not permitted here");
                } else {
                    await mjolnir.managementRoomOutput.logMessage(
                        LogLevel.WARN,
                        "MessageIsVideo",
                        `Tried to redact ${event["event_id"]} in ${roomId} but Mjolnir is running in no-op mode`,
                        roomId,
                    );
                }
            }
        }
    }
}
