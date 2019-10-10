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
import { RULE_ROOM, RULE_SERVER, RULE_USER, ruleTypeToStable, USER_RULE_TYPES } from "../models/BanList";
import { RichReply } from "matrix-bot-sdk";
import { RECOMMENDATION_BAN, recommendationToStable } from "../models/ListRule";
import { MatrixGlob } from "matrix-bot-sdk/lib/MatrixGlob";
import config from "../config";

function parseBits(parts: string[]): { listShortcode: string, entityType: string, ruleType: string, glob: string, reason: string } {
    const shortcode = parts[2].toLowerCase();
    const entityType = parts[3].toLowerCase();
    const glob = parts[4];
    const reason = parts.slice(5).join(' ') || "<no reason>";

    let rule = null;
    if (entityType === "user") {
        rule = RULE_USER;
    } else if (entityType === "room") {
        rule = RULE_ROOM;
    } else if (entityType === "server") {
        rule = RULE_SERVER;
    }
    if (!rule) {
        return {listShortcode: shortcode, entityType, ruleType: null, glob, reason};
    }
    rule = ruleTypeToStable(rule);

    return {listShortcode: shortcode, entityType, ruleType: rule, glob, reason};
}

// !mjolnir ban <shortcode> <user|server|room> <glob> [reason]
export async function execBanCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const bits = parseBits(parts);
    if (!bits.ruleType) {
        const replyText = "Unknown entity type '" + bits.entityType + "' - try one of user, room, or server";
        const reply = RichReply.createFor(roomId, event, replyText, replyText);
        reply["msgtype"] = "m.notice";
        return mjolnir.client.sendMessage(roomId, reply);
    }

    const recommendation = recommendationToStable(RECOMMENDATION_BAN);
    const ruleContent = {
        entity: bits.glob,
        recommendation,
        reason: bits.reason,
    };
    const stateKey = `rule:${bits.glob}`;

    const list = mjolnir.lists.find(b => b.listShortcode === bits.listShortcode);
    if (!list) {
        const replyText = "No ban list with that shortcode was found.";
        const reply = RichReply.createFor(roomId, event, replyText, replyText);
        reply["msgtype"] = "m.notice";
        return mjolnir.client.sendMessage(roomId, reply);
    }

    await mjolnir.client.sendStateEvent(list.roomId, bits.ruleType, stateKey, ruleContent);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir unban <shortcode> <user|server|room> <glob> [apply:t/f]
export async function execUnbanCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const bits = parseBits(parts);
    if (!bits.ruleType) {
        const replyText = "Unknown entity type '" + bits.entityType + "' - try one of user, room, or server";
        const reply = RichReply.createFor(roomId, event, replyText, replyText);
        reply["msgtype"] = "m.notice";
        return mjolnir.client.sendMessage(roomId, reply);
    }

    const ruleContent = {}; // empty == clear/unban
    const stateKey = `rule:${bits.glob}`;

    const list = mjolnir.lists.find(b => b.listShortcode === bits.listShortcode);
    if (!list) {
        const replyText = "No ban list with that shortcode was found.";
        const reply = RichReply.createFor(roomId, event, replyText, replyText);
        reply["msgtype"] = "m.notice";
        return mjolnir.client.sendMessage(roomId, reply);
    }

    await mjolnir.client.sendStateEvent(list.roomId, bits.ruleType, stateKey, ruleContent);

    if (USER_RULE_TYPES.includes(bits.ruleType) && parts.length > 5 && parts[5] === 'true') {
        const rule = new MatrixGlob(bits.glob);
        await mjolnir.client.sendNotice(mjolnir.managementRoomId, "Unbanning users that match glob: " + bits.glob);
        let unbannedSomeone = false;
        for (const protectedRoomId of Object.keys(mjolnir.protectedRooms)) {
            const members = await mjolnir.client.getMembers(protectedRoomId, null, ['ban'], null);
            for (const member of members) {
                const victim = member['state_key'];
                if (!member['content'] || member['content']['membership'] !== 'ban') continue;
                if (rule.test(victim)) {
                    if (config.verboseLogging) {
                        await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Unbanning ${victim} in ${protectedRoomId}`);
                    }
                    if (!config.noop) {
                        await mjolnir.client.unbanUser(victim, protectedRoomId);
                    }
                    unbannedSomeone = true;
                }
            }
        }

        if (unbannedSomeone) {
            if (config.verboseLogging) {
                await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Syncing lists to ensure no users were accidentally unbanned`);
            }
            await mjolnir.syncLists(config.verboseLogging);
        }
    }

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
