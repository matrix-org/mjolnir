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
import { RichReply } from "matrix-bot-sdk";
import { htmlEscape } from "../utils";

// !mjolnir rules
export async function execDumpRulesCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    let html = "<b>Rules currently in use:</b><br/>";
    let text = "Rules currently in use:\n";

    let hasLists = false;
    for (const list of mjolnir.lists) {
        hasLists = true;
        let hasRules = false;

        const shortcodeInfo = list.listShortcode ? ` (shortcode: ${list.listShortcode})` : '';

        html += `<a href="${list.roomRef}">${list.roomId}</a>${shortcodeInfo}:<br/><ul>`;
        text += `${list.roomRef}${shortcodeInfo}:\n`;

        for (const rule of list.serverRules) {
            hasRules = true;
            html += `<li>server (<code>${rule.recommendation}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})</li>`;
            text += `* server (${rule.recommendation}): ${rule.entity} (${rule.reason})\n`;
        }

        for (const rule of list.userRules) {
            hasRules = true;
            html += `<li>user (<code>${rule.recommendation}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})</li>`;
            text += `* user (${rule.recommendation}): ${rule.entity} (${rule.reason})\n`;
        }

        for (const rule of list.roomRules) {
            hasRules = true;
            html += `<li>room (<code>${rule.recommendation}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})</li>`;
            text += `* room (${rule.recommendation}): ${rule.entity} (${rule.reason})\n`;
        }

        if (!hasRules) {
            html += "<li><i>No rules</i>";
            text += "* No rules\n";
        }

        html += "</ul>";
        text += "\n";
    }

    if (!hasLists) {
        html = "No ban lists configured";
        text = "No ban lists configured";
    }

    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    return mjolnir.client.sendMessage(roomId, reply);
}
