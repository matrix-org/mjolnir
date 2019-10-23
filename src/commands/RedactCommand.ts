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
import { getMessagesByUserSinceLastJoin } from "../utils";
import config from "../config";

// !mjolnir redact <user ID> [room alias]
export async function execRedactCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const userId = parts[2];
    let roomAlias = null;
    if (parts.length > 3) {
        roomAlias = await mjolnir.client.resolveRoom(parts[3]);
    }

    const targetRoomIds = roomAlias ? [roomAlias] : Object.keys(mjolnir.protectedRooms);
    for (const targetRoomId of targetRoomIds) {
        if (config.verboseLogging) {
            await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Fetching sent messages for ${userId} in ${targetRoomId} to redact...`);
        }

        const eventsToRedact = await getMessagesByUserSinceLastJoin(mjolnir.client, userId, targetRoomId);
        for (const victimEvent of eventsToRedact) {
            if (config.verboseLogging) {
                await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Redacting ${victimEvent['event_id']} in ${targetRoomId}`);
            }
            if (!config.noop) {
                await mjolnir.client.redactEvent(targetRoomId, victimEvent['event_id']);
            }
        }
    }

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
