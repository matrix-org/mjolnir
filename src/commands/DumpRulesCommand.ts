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

import { RichReply } from "matrix-bot-sdk";
import { Mjolnir } from "../Mjolnir";
import { RULE_ROOM, RULE_SERVER, RULE_USER } from "../models/BanList";
import { htmlEscape } from "../utils";

/**
 * List all of the rules that match a given entity.
 * The reason why you want to test against all rules and not just e.g. user or server is because
 * there are situations where rules of different types can ban other entities e.g. server ACL can cause users to be banned.
 * @param roomId The room the command is from.
 * @param event The event containing the command.
 * @param mjolnir A mjolnir to fetch the watched lists from.
 * @param entity a user, room id or server.
 * @returns When a response has been sent to the command.
 */
export async function execRulesMatchingCommand(roomId: string, event: any, mjolnir: Mjolnir, entity: string) {
    let html = "";
    let text = "";
    for (const list of mjolnir.lists) {
        const matches =  list.rulesMatchingEntity(entity)

        if (matches.length === 0) {
            continue;
        }

        const matchesInfo = `Found ${matches.length} ` + (matches.length === 1 ? 'match:' : 'matches:');
        const shortcodeInfo = list.listShortcode ? ` (shortcode: ${htmlEscape(list.listShortcode)})` : '';

        html += `<a href="${htmlEscape(list.roomRef)}">${htmlEscape(list.roomId)}</a>${shortcodeInfo} ${matchesInfo}<br/><ul>`;
        text += `${list.roomRef}${shortcodeInfo} ${matchesInfo}:\n`;

        for (const rule of matches) {
            // If we know the rule kind, we will give it a readable name, otherwise just use its name.
            let ruleKind: string = rule.kind;
            if (ruleKind === RULE_USER) {
                ruleKind = 'user';
            } else if (ruleKind === RULE_SERVER) {
                ruleKind = 'server';
            } else if (ruleKind === RULE_ROOM) {
                ruleKind = 'room';
            }
            html += `<li>${htmlEscape(ruleKind)} (<code>${htmlEscape(rule.recommendation ?? "")}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})</li>`;
            text += `* ${ruleKind} (${rule.recommendation}): ${rule.entity} (${rule.reason})\n`;
        }

        html += "</ul>";
    }

    if (text.length === 0) {
        html += `No results for ${htmlEscape(entity)}`;
        text += `No results for ${entity}`;
    }
    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    return mjolnir.client.sendMessage(roomId, reply);
}

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
