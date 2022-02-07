/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

// !mjolnir move <alias> <new room ID>
export async function execMoveAliasCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const movingAlias = parts[2];
    const targetRoom = parts[3];

    const isAdmin = await mjolnir.isSynapseAdmin();
    if (!isAdmin) {
        const message = "I am not a Synapse administrator, or the endpoint is blocked";
        const reply = RichReply.createFor(roomId, event, message, message);
        reply['msgtype'] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    await mjolnir.client.deleteRoomAlias(movingAlias);
    const newRoomId = await mjolnir.client.resolveRoom(targetRoom);
    await mjolnir.client.createRoomAlias(movingAlias, newRoomId);

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir alias add <alias> <target room>
export async function execAddAliasCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const aliasToAdd = parts[3];
    const targetRoom = parts[4];

    const isAdmin = await mjolnir.isSynapseAdmin();
    if (!isAdmin) {
        const message = "I am not a Synapse administrator, or the endpoint is blocked";
        const reply = RichReply.createFor(roomId, event, message, message);
        reply['msgtype'] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    const newRoomId = await mjolnir.client.resolveRoom(targetRoom);
    await mjolnir.client.createRoomAlias(aliasToAdd, newRoomId);

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir alias remove <alias>
export async function execRemoveAliasCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const aliasToRemove = parts[3];

    const isAdmin = await mjolnir.isSynapseAdmin();
    if (!isAdmin) {
        const message = "I am not a Synapse administrator, or the endpoint is blocked";
        const reply = RichReply.createFor(roomId, event, message, message);
        reply['msgtype'] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    await mjolnir.client.deleteRoomAlias(aliasToRemove);

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir resolve <alias>
export async function execResolveCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const toResolve = parts[2];

    const resolvedRoomId = await mjolnir.client.resolveRoom(toResolve);

    const message = `Room ID for ${toResolve} is ${resolvedRoomId}`;
    const html = `Room ID for ${htmlEscape(toResolve)} is ${htmlEscape(resolvedRoomId)}`;
    const reply = RichReply.createFor(roomId, event, message, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}
