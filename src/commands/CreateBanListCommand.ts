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
import PolicyList from "../models/PolicyList";
import { Permalinks, RichReply } from "matrix-bot-sdk";

// !mjolnir list create <shortcode> <alias localpart>
export async function execCreateListCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const shortcode = parts[3];
    const aliasLocalpart = parts[4];

    const listRoomId = await PolicyList.createList(
        mjolnir.client,
        shortcode,
        [event['sender']],
        { room_alias_name: aliasLocalpart }
    );

    const roomRef = Permalinks.forRoom(listRoomId);
    await mjolnir.policyListManager.watchList(roomRef);
    await mjolnir.addProtectedRoom(listRoomId);

    const html = `Created new list (<a href="${roomRef}">${listRoomId}</a>). This list is now being watched.`;
    const text = `Created new list (${roomRef}). This list is now being watched.`;
    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}
