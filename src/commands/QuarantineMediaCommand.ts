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

import { MXCUrl } from "@vector-im/matrix-bot-sdk";
import { Mjolnir } from "../Mjolnir";

// !mjolnir quarantine-media <user ID> [room alias] [limit]
// !mjolnir quarantine-media <server> [room alias] [limit]
// !mjolnir quarantine-media <room ID> [limit]
// !mjolnir quarantine-media <mxc-url>
export async function execRedactCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const target = parts[2];

    let targetRoom: string | null = null;
    let limit = Number.parseInt(parts.length > 3 ? parts[3] : "", 10); // default to NaN for later
    if (parts.length > 3 && isNaN(limit)) {
        targetRoom = await mjolnir.client.resolveRoom(parts[3]);
        if (parts.length > 4) {
            limit = Number.parseInt(parts[4], 10);
        }
    }

    // Make sure we always have a limit set
    if (isNaN(limit)) limit = 1000;

    const processingReactionId = await mjolnir.client.unstableApis.addReactionToEvent(
        roomId,
        event["event_id"],
        "In Progress",
    );

    let mxcs: Iterable<MXCUrl>;
    const targetRooms = targetRoom ? [targetRoom] : mjolnir.protectedRoomsTracker.getProtectedRooms();

    if (target.startsWith("@")) {
        // User ID
        mxcs = mjolnir.protectedRoomsTracker.getMediaIdsForUserIdInRooms(target, targetRooms);
    } else if (target.startsWith("!") || target.startsWith("#")) {
        // Room ID
        mxcs = mjolnir.protectedRoomsTracker.getMediaIdsForRoomId(await mjolnir.client.resolveRoom(target));
    } else if (target.startsWith("mxc://")) {
        // MXC
        mxcs = [MXCUrl.parse(target)];
    } else {
        // Server
        mxcs = mjolnir.protectedRoomsTracker.getMediaIdsForServerInRooms(target, targetRooms);
    }

    let mediaItemsCompleted = 0;
    for (const mxc of mxcs) {
        await mjolnir.quarantineMedia(mxc);
        mediaItemsCompleted++;
        if (mediaItemsCompleted === limit) {
            break;
        }
    }

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
    await mjolnir.client.redactEvent(roomId, processingReactionId, "done processing");
}
