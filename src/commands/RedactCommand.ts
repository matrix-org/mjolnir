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
import { redactUserMessagesIn } from "../utils";
import { Permalinks, RichReply } from "@vector-im/matrix-bot-sdk";

// !mjolnir redact <user ID> [room alias] [limit] --quarantine
export async function execRedactCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const userId = parts[2];

    let targetRoom: string | null = null;

    let quarantine = false;
    if (parts.includes("--quarantine")) {
        parts = parts.filter((p) => p !== "--quarantine");
        quarantine = true;
    }

    if (quarantine && !(await mjolnir.isSynapseAdmin())) {
        const message =
            "Quarantine flag specified but I am not a Synapse administrator, or the endpoint is blocked. Redaction did not run.";
        const reply = RichReply.createFor(roomId, event, message, message);
        reply["msgtype"] = "m.notice";
        await mjolnir.client.sendMessage(roomId, reply);
        return;
    }

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

    if (userId[0] !== "@") {
        // Assume it's a permalink
        const parsed = Permalinks.parseUrl(parts[2]);
        const targetRoomId = await mjolnir.client.resolveRoom(parsed.roomIdOrAlias);
        await mjolnir.client.redactEvent(targetRoomId, parsed.eventId);
        if (quarantine) {
            const mxcs = mjolnir.protectedRoomsTracker.getMediaIdsForEventId(targetRoomId, parsed.eventId);
            for (const mxc of mxcs) {
                await mjolnir.quarantineMedia(mxc);
            }
        }
        await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
        await mjolnir.client.redactEvent(roomId, processingReactionId, "done processing command");
        return;
    }

    const targetRoomIds = targetRoom ? [targetRoom] : mjolnir.protectedRoomsTracker.getProtectedRooms();
    const isAdmin = await mjolnir.isSynapseAdmin();
    await redactUserMessagesIn(mjolnir.client, mjolnir.managementRoomOutput, userId, targetRoomIds, isAdmin, limit);
    if (quarantine) {
        const mxcs = await mjolnir.protectedRoomsTracker.getMediaIdsForUserIdInRooms(userId, targetRoomIds);
        for (const mxc of mxcs) {
            await mjolnir.quarantineMedia(mxc);
        }
    }
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
    await mjolnir.client.redactEvent(roomId, processingReactionId, "done processing");
}
