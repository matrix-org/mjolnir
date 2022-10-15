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
import { EntityType } from "../models/ListRule";
import { htmlEscape } from "../utils";
import { ListMessageSplitter } from "../ListMessageSplitter";

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
        const matches = list.rulesMatchingEntity(entity)

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
            switch (ruleKind) {
                case EntityType.RULE_USER:
                    ruleKind = 'user';
                    break;
                case EntityType.RULE_SERVER:
                    ruleKind = 'server';
                    break;
                case EntityType.RULE_ROOM:
                    ruleKind = 'room';
                    break;
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
    let splitter = new ListMessageSplitter();

    splitter.addHeader("<b>Rules currently in use:</b>", "Rules currently in use:");

    for (const list of mjolnir.lists) {
        let hasRules = false;

        const shortcodeInfo = list.listShortcode ? ` (shortcode: ${list.listShortcode})` : '';

        splitter.addHeader(`<a href="${list.roomRef}">${list.roomId}</a>${shortcodeInfo}:`, `${list.roomRef}${shortcodeInfo}:`);

        for (const rule of list.serverRules) {
            hasRules = true;

            splitter.addParagraph(
                `server (<code>${rule.recommendation}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})`,
                `server (${rule.recommendation}): ${rule.entity} (${rule.reason})`
            )
        }

        for (const rule of list.userRules) {
            hasRules = true;

            splitter.addParagraph(
                `user (<code>${rule.recommendation}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})`,
                `user (${rule.recommendation}): ${rule.entity} (${rule.reason})`
            )
        }

        for (const rule of list.roomRules) {
            hasRules = true;

            splitter.addParagraph(
                `room (<code>${rule.recommendation}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})`,
                `room (${rule.recommendation}): ${rule.entity} (${rule.reason})`
            )
        }

        if (!hasRules) {
            splitter.addParagraph(
                "<i>No rules</i>",
                "No rules"
            )
        }
    }

    if (mjolnir.lists.length === 0) {
        splitter.addParagraph(
            "No ban lists configured",
            "No ban lists configured"
        )
    }

    await splitter.reply(mjolnir.client, roomId, event, true);
}
