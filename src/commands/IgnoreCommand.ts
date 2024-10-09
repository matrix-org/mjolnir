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

import {Mjolnir} from "../Mjolnir";
import {LogLevel, RichReply} from "@vector-im/matrix-bot-sdk";

// !mjolnir ignore <user|server>
export async function execIgnoreCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const target = parts[2];

    await mjolnir.managementRoomOutput.logMessage(LogLevel.INFO, "IgnoreCommand", `Adding ${target} to internal moderator list.`);
    mjolnir.moderators.push(target)
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir ignored
export async function execListIgnoredCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {

    let html = "Ignored users:<ul>";
    let text = "Ignored users:\n";

    for (const name of mjolnir.moderators) {
        html += `<li>${name}</li>`;
        text += `* ${name}\n`;
    }

    html += "</ul>";

    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}