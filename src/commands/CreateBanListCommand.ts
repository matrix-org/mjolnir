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

import { Mjolnir } from "../Mjolnir";
import { SHORTCODE_EVENT_TYPE } from "../models/BanList";
import { Permalinks, RichReply } from "matrix-bot-sdk";

// !mjolnir list create <shortcode> <alias localpart>
export async function execCreateListCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const shortcode = parts[3];
    const aliasLocalpart = parts[4];

    const powerLevels: { [key: string]: any } = {
        "ban": 50,
        "events": {
            "m.room.name": 100,
            "m.room.power_levels": 100,
        },
        "events_default": 50, // non-default
        "invite": 0,
        "kick": 50,
        "notifications": {
            "room": 20,
        },
        "redact": 50,
        "state_default": 50,
        "users": {
            [await mjolnir.client.getUserId()]: 100,
            [event["sender"]]: 50
        },
        "users_default": 0,
    };

    const listRoomId = await mjolnir.client.createRoom({
        preset: "public_chat",
        room_alias_name: aliasLocalpart,
        invite: [event['sender']],
        initial_state: [{type: SHORTCODE_EVENT_TYPE, state_key: "", content: {shortcode: shortcode}}],
        power_level_content_override: powerLevels,
    });

    const roomRef = Permalinks.forRoom(listRoomId);
    await mjolnir.watchList(roomRef);

    const html = `Created new list (<a href="${roomRef}">${listRoomId}</a>). This list is now being watched.`;
    const text = `Created new list (${roomRef}). This list is now being watched.`;
    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}
