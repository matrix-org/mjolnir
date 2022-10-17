/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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
import { Permalinks, RichReply } from "matrix-bot-sdk";

// !mjolnir rooms
export async function execListProtectedRooms(roomId: string, event: any, mjolnir: Mjolnir) {
    const rooms = mjolnir.protectedRoomsTracker.getProtectedRooms();
    let html = `<b>Protected rooms (${rooms.length}):</b><br/><ul>`;
    let text = `Protected rooms (${rooms.length}):\n`;

    let hasRooms = false;
    for (const protectedRoomId of rooms) {
        hasRooms = true;

        const roomUrl = Permalinks.forRoom(protectedRoomId);
        html += `<li><a href="${roomUrl}">${protectedRoomId}</a></li>`;
        text += `* ${roomUrl}\n`;
    }

    html += "</ul>";

    if (!hasRooms) {
        html = "No protected rooms";
        text = "No protected rooms";
    }

    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    return mjolnir.client.sendMessage(roomId, reply);
}
