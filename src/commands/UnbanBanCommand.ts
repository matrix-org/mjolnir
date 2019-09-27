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
import { RULE_ROOM, RULE_SERVER, RULE_USER, ruleTypeToStable } from "../models/BanList";
import { RichReply } from "matrix-bot-sdk";
import { RECOMMENDATION_BAN, recommendationToStable } from "../models/ListRule";

function parseBits(parts: string[]): { entityType: string, ruleType: string, glob: string, reason: string } {
    const entityType = parts[2].toLowerCase();
    const glob = parts[3];
    const reason = parts.slice(4).join(' ') || "<no reason>";

    let rule = null;
    if (entityType === "user") {
        rule = RULE_USER;
    } else if (entityType === "room") {
        rule = RULE_ROOM;
    } else if (entityType === "server") {
        rule = RULE_SERVER;
    }
    if (!rule) {
        return {entityType, ruleType: null, glob, reason};
    }
    rule = ruleTypeToStable(rule);

    return {entityType, ruleType: rule, glob, reason};
}

// !mjolnir ban <user|server|room> <glob> [reason]
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

    await mjolnir.client.sendStateEvent(mjolnir.publishedBanListRoomId, bits.ruleType, stateKey, ruleContent);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}


// !mjolnir unban <user|server|room> <glob>
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

    await mjolnir.client.sendStateEvent(mjolnir.publishedBanListRoomId, bits.ruleType, stateKey, ruleContent);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
