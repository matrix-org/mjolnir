/*
Copyright 2021, 2022 Marco Cirillo

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

// !mjolnir make admin <room> [<user ID>]
export async function execMakeRoomAdminCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const isAdmin = await mjolnir.isSynapseAdmin();
    if (!mjolnir.config.admin?.enableMakeRoomAdminCommand || !isAdmin) {
        const message = "Either the command is disabled or I am not running as homeserver administrator.";
        const reply = RichReply.createFor(roomId, event, message, message);
        reply['msgtype'] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    let err = await mjolnir.makeUserRoomAdmin(await mjolnir.client.resolveRoom(parts[3]), parts[4]);
    if (err instanceof Error || typeof (err) === "string") {
        const errMsg = "Failed to process command:";
        const message = typeof (err) === "string" ? `${errMsg}: ${err}` : `${errMsg}: ${err.message}`;
        const reply = RichReply.createFor(roomId, event, message, message);
        reply['msgtype'] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    } else {
        await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
    }
}
