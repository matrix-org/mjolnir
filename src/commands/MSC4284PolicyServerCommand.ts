/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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
import { LogLevel } from "@vector-im/matrix-bot-sdk";

// !mjolnir msc4284_set <roomId|alias|*> <server|'unset'>
export async function execMSC4284SetCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const inRoomIds: string[] = [];
    const policyServer = parts[3];

    const target = parts[2];
    if (target === "*") {
        mjolnir.protectedRoomsTracker.getProtectedRooms().forEach((protectedRoomId) => inRoomIds.push(protectedRoomId));
    } else {
        inRoomIds.push(await mjolnir.client.resolveRoom(target));
    }

    // Actually set the state events
    let content: { via?: string } = { via: policyServer };
    if (policyServer === "unset") {
        content = {}; // no via == unset/disabled
    }
    for (const targetRoomId of inRoomIds) {
        await mjolnir.managementRoomOutput.logMessage(
            LogLevel.DEBUG,
            "MSC4284PolicyServerCommand",
            `Setting policy server for room ${targetRoomId} to '${policyServer}'`,
        );
        await mjolnir.client.sendStateEvent(targetRoomId, "org.matrix.msc4284.policy", "", content);
    }

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
}
