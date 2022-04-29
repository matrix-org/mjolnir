/*
Copyright 2019-2022 The Matrix.org Foundation C.I.C.

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

import { Mjolnir, STATE_CHECKING_PERMISSIONS, STATE_NOT_STARTED, STATE_RUNNING, STATE_SYNCING } from "../Mjolnir";
import { RichReply } from "matrix-bot-sdk";
import { htmlEscape } from "../utils";
import { default as parseDuration } from "parse-duration";
import { HumanizeDurationLanguage, HumanizeDuration } from "humanize-duration-ts";

// Define a few aliases to simplify parsing durations.

parseDuration["days"] = parseDuration["day"];
parseDuration["weeks"] = parseDuration["week"] = parseDuration["wk"];
parseDuration["months"] = parseDuration["month"];
parseDuration["years"] = parseDuration["year"];

const HUMANIZE_LAG_SERVICE: HumanizeDurationLanguage = new HumanizeDurationLanguage();
const HUMANIZER: HumanizeDuration = new HumanizeDuration(HUMANIZE_LAG_SERVICE);

// !mjolnir
export async function execStatusCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    switch (parts[0]) {
        case undefined:
        case 'mjolnir':
            return showMjolnirStatus(roomId, event, mjolnir);
        case 'protection':
            return showProtectionStatus(roomId, event, mjolnir, parts.slice(/* ["protection"] */ 1));
        case 'joins':
            return showJoinsStatus(roomId, event, mjolnir, parts.slice(/* ["joins"] */ 1));
        default:
            throw new Error(`Invalid status command: ${htmlEscape(parts[0])}`);
    }
}

async function showMjolnirStatus(roomId: string, event: any, mjolnir: Mjolnir) {
    // Display the status of Mjölnir.
    let html = "";
    let text = "";

    const state = mjolnir.state;

    switch (state) {
        case STATE_NOT_STARTED:
            html += "<b>Running: </b>❌ (not started)<br/>";
            text += "Running: ❌ (not started)\n";
            break;
        case STATE_CHECKING_PERMISSIONS:
            html += "<b>Running: </b>❌ (checking own permissions)<br/>";
            text += "Running: ❌ (checking own permissions)\n";
            break;
        case STATE_SYNCING:
            html += "<b>Running: </b>❌ (syncing lists)<br/>";
            text += "Running: ❌ (syncing lists)\n";
            break;
        case STATE_RUNNING:
            html += "<b>Running: </b>✅<br/>";
            text += "Running: ✅\n";
            break;
        default:
            html += "<b>Running: </b>❌ (unknown state)<br/>";
            text += "Running: ❌ (unknown state)\n";
            break;
    }

    html += `<b>Protected rooms: </b> ${Object.keys(mjolnir.protectedRooms).length}<br/>`;
    text += `Protected rooms: ${Object.keys(mjolnir.protectedRooms).length}\n`;

    // Append list information
    html += "<b>Subscribed ban lists:</b><br><ul>";
    text += "Subscribed ban lists:\n";
    for (const list of mjolnir.lists) {
        const ruleInfo = `rules: ${list.serverRules.length} servers, ${list.userRules.length} users, ${list.roomRules.length} rooms`;
        html += `<li><a href="${list.roomRef}">${list.roomId}</a> (${ruleInfo})</li>`;
        text += `* ${list.roomRef} (${ruleInfo})\n`;
    }
    if (mjolnir.lists.length === 0) {
        html += "<li><i>None</i></li>";
        text += "* None\n";
    }
    html += "</ul>";

    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    return mjolnir.client.sendMessage(roomId, reply);
}

async function showProtectionStatus(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const protectionName = parts[0];
    const protection = mjolnir.getProtection(protectionName);
    let text;
    let html;
    if (!protection) {
        text = html = "Unknown protection";
    } else {
        const status = await protection.statusCommand(mjolnir, parts.slice(1));
        if (status) {
            text = status.text;
            html = status.html;
        } else {
            text = "<no status>";
            html = "&lt;no status&gt;";
        }
    }
    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}

/**
 * Show the most recent joins to a room.
 */
async function showJoinsStatus(destinationRoomId: string, event: any, mjolnir: Mjolnir, args: string[]) {
    const targetRoomAliasOrId = args[0];
    const maxAgeArg = args[1] || "1 day";
    const maxEntriesArg = args[2] = "200";
    const { html, text } = await (async () => {
        if (!targetRoomAliasOrId) {
            return {
                html: "Missing arg: <code>room id</code>",
                text: "Missing arg: `room id`"
            };
        }
        const maxAgeMS = parseDuration(maxAgeArg);
        if (!maxAgeMS) {
            return {
                html: "Invalid duration. Example: <code>1.5 days</code> or <code>10 minutes</code>",
                text: "Invalid duration. Example: `1.5 days` or `10 minutes`",
            }
        }
        const maxEntries = Number.parseInt(maxEntriesArg, 10);
        if (!maxEntries) {
            return {
                html: "Invalid number of entries. Example: <code>200</code>",
                text: "Invalid number of entries. Example: `200`",
            }
        }
        const minDate = new Date(Date.now() - maxAgeMS);
        const HUMANIZER_OPTIONS = {
            // Reduce "1 day" => "1day" to simplify working with CSV.
            spacer: "",
            // Reduce "1 day, 2 hours" => "1.XXX day" to simplify working with CSV.
            largest: 1,
        };
        const maxAgeHumanReadable = HUMANIZER.humanize(maxAgeMS, HUMANIZER_OPTIONS);
        let targetRoomId;
        try {
            targetRoomId = await mjolnir.client.resolveRoom(targetRoomAliasOrId);
        } catch (ex) {
            return {
                html: `Cannot resolve room ${htmlEscape(targetRoomAliasOrId)}.`,
                text: `Cannot resolve room \`${targetRoomAliasOrId}\`.`
            }
        }
        const joins = mjolnir.roomJoins.getUsersInRoom(targetRoomId, minDate, maxEntries);
        const htmlFragments = [];
        const textFragments = [];
        for (let join of joins) {
            const durationHumanReadable = HUMANIZER.humanize(Date.now() - join.timestamp, HUMANIZER_OPTIONS);
            htmlFragments.push(`<li>${htmlEscape(join.userId)}: ${durationHumanReadable}</li>`);
            textFragments.push(`- ${join.userId}: ${durationHumanReadable}`);
        }
        return {
            html: `${joins.length} recent joins (cut at ${maxAgeHumanReadable} ago / ${maxEntries} entries): <ul> ${htmlFragments.join()} </ul>`,
            text: `${joins.length} recent joins (cut at ${maxAgeHumanReadable} ago / ${maxEntries} entries):\n${textFragments.join("\n")}`
        }
    })();
    const reply = RichReply.createFor(destinationRoomId, event, text, html);
    reply["msgtype"] = "m.notice";
    return mjolnir.client.sendMessage(destinationRoomId, reply);
}

