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
import { LogLevel, RichReply } from "@vector-im/matrix-bot-sdk";

// !mjolnir shutdown room <room> [<message>]
export async function execShutdownRoomCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const target = parts[3];
    const reason = parts.slice(4).join(" ") || undefined;

    const isAdmin = await mjolnir.isSynapseAdmin();
    if (!isAdmin) {
        const message = "I am not a Synapse administrator, or the endpoint is blocked";
        const reply = RichReply.createFor(roomId, event, message, message);
        reply["msgtype"] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    let protectedRooms;
    if (mjolnir.config.protectAllJoinedRooms) {
        protectedRooms = await mjolnir.client.getJoinedRooms();
    } else {
        protectedRooms = mjolnir.protectedRoomsConfig.getExplicitlyProtectedRooms();
    }
    if (protectedRooms.includes(target)) {
        await mjolnir.managementRoomOutput.logMessage(
            LogLevel.INFO,
            "ShutdownRoomCommand",
            "You are attempting to shutdown a room that mjolnir currently protects, aborting.",
        );
        return;
    }

    await mjolnir.shutdownSynapseRoom(await mjolnir.client.resolveRoom(target), reason);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
}
