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
import { EntityType } from "../models/ListRule";
import PolicyList from "../models/PolicyList";

// !mjolnir import <room ID> <shortcode>
export async function execImportCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const importRoomId = await mjolnir.client.resolveRoom(parts[2]);
    const list = mjolnir.policyListManager.lists.find(b => b.listShortcode === parts[3]) as PolicyList;
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
                await list.banEntity(EntityType.RULE_USER, stateEvent['state_key'], reason);
                importedRules++;
            }
        } else if (stateEvent['type'] === 'm.room.server_acl' && stateEvent['state_key'] === '') {
            // ACL event - ban denied servers
            if (!content['deny']) continue;
            for (const server of content['deny']) {
                const reason = "<no reason>";

                await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Adding server ${server} to ban list`);

                await list.banEntity(EntityType.RULE_SERVER, server, reason);
                importedRules++;
            }
        }
    }

    const message = `Imported ${importedRules} rules to ban list`;
    const reply = RichReply.createFor(roomId, event, message, message);
    reply['msgtype'] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}
