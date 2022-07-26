/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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
import { RECOMMENDATION_BAN, recommendationToStable } from "../models/ListRule";
import { RULE_SERVER, RULE_USER, ruleTypeToStable } from "../models/BanList";
import { Command, Lexer, Token } from "./Command";

// !mjolnir import <room ID> <shortcode>
export class ImportCommand implements Command {
    public readonly command: 'import';
    public readonly helpDescription: 'Imports bans and ACLs into the given list';
    public readonly helpArgs: '<room alias/ID> <list shortcode>';
    async exec(mjolnir: Mjolnir, roomId: string, lexer: Lexer, event: any): Promise<void> {
        const importRoomId = await mjolnir.client.resolveRoom(lexer.token(Token.ROOM_ALIAS_OR_ID).text);
        const shortcode = lexer.token(Token.WORD).text;
        const list = mjolnir.lists.find(b => b.listShortcode === shortcode);
        if (!list) {
            const errMessage = "Unable to find list - check your shortcode.";
            const errReply = RichReply.createFor(roomId, event, errMessage, errMessage);
            errReply["msgtype"] = "m.notice";
            mjolnir.client.sendMessage(roomId, errReply);
            return;
        }

        let importedRules = 0;

        const state = await mjolnir.client.getRoomState(importRoomId);
        for (const stateEvent of state) {
            const content = stateEvent['content'] || {};
            if (!content || Object.keys(content).length === 0) continue;

            if (stateEvent['type'] === 'm.room.member' && stateEvent['state_key'] !== '') {
                // Member event - check for ban
                if (content['membership'] === 'ban') {
                    const reason = content['reason'] || '<no reason>';

                    await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Adding user ${stateEvent['state_key']} to ban list`);

                    const recommendation = recommendationToStable(RECOMMENDATION_BAN);
                    const ruleContent = {
                        entity: stateEvent['state_key'],
                        recommendation,
                        reason: reason,
                    };
                    const stateKey = `rule:${ruleContent.entity}`;
                    let stableRule = ruleTypeToStable(RULE_USER);
                    if (stableRule) {
                        await mjolnir.client.sendStateEvent(list.roomId, stableRule, stateKey, ruleContent);
                    }
                    importedRules++;
                }
            } else if (stateEvent['type'] === 'm.room.server_acl' && stateEvent['state_key'] === '') {
                // ACL event - ban denied servers
                if (!content['deny']) continue;
                for (const server of content['deny']) {
                    const reason = "<no reason>";

                    await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Adding server ${server} to ban list`);

                    const recommendation = recommendationToStable(RECOMMENDATION_BAN);
                    const ruleContent = {
                        entity: server,
                        recommendation,
                        reason: reason,
                    };
                    const stateKey = `rule:${ruleContent.entity}`;
                    let stableRule = ruleTypeToStable(RULE_SERVER);
                    if (stableRule) {
                        await mjolnir.client.sendStateEvent(list.roomId, stableRule, stateKey, ruleContent);
                    }
                    importedRules++;
                }
            }
        }

        const message = `Imported ${importedRules} rules to ban list`;
        const reply = RichReply.createFor(roomId, event, message, message);
        reply['msgtype'] = "m.notice";
        await mjolnir.client.sendMessage(roomId, reply);
    }
}
