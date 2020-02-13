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

async function addRemoveFromDirectory(inRoomId: string, event: any, mjolnir: Mjolnir, roomRef: string, visibility: "public" | "private") {
    const isAdmin = await mjolnir.isSynapseAdmin();
    if (!isAdmin) {
        const message = "I am not a Synapse administrator, or the endpoint is blocked";
        const reply = RichReply.createFor(inRoomId, event, message, message);
        reply['msgtype'] = "m.notice";
        return mjolnir.client.sendMessage(inRoomId, reply);
    }

    const targetRoomId = await mjolnir.client.resolveRoom(roomRef);
    await mjolnir.client.setDirectoryVisibility(targetRoomId, visibility);

    await mjolnir.client.unstableApis.addReactionToEvent(inRoomId, event['event_id'], '✅');
}

// !mjolnir directory add <room>
export async function execAddRoomToDirectoryCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    await addRemoveFromDirectory(roomId, event, mjolnir, parts[3], "public");
}

// !mjolnir directory remove <room>
export async function execRemoveRoomFromDirectoryCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    await addRemoveFromDirectory(roomId, event, mjolnir, parts[3], "private");
}
