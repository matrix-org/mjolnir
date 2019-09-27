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

// !mjolnir
export async function execStatusCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    let html = "";
    let text = "";

    // Append header information first
    html += "<b>Running: </b>✅<br/>";
    text += "Running: ✅\n";
    html += `<b>Protected rooms: </b> ${Object.keys(mjolnir.protectedRooms).length}<br/>`;
    text += `Protected rooms: ${mjolnir.protectedRooms.length}\n`;

    // Append list information
    html += "<b>Subscribed ban lists:</b><br><ul>";
    text += "Subscribed ban lists:\n";
    for (const list of mjolnir.banLists) {
        const ruleInfo = `rules: ${list.serverRules.length} servers, ${list.userRules.length} users, ${list.roomRules.length} rooms`;
        html += `<li><a href="${list.roomRef}">${list.roomId}</a> (${ruleInfo})</li>`;
        text += `${list.roomRef} (${ruleInfo})\n`;
    }
    html += "</ul>";

    const message = {
        msgtype: "m.notice",
        body: text,
        format: "org.matrix.custom.html",
        formatted_body: html,
    };
    return mjolnir.client.sendMessage(roomId, message);
}
