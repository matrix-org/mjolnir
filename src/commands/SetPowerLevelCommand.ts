/*
Copyright 2020-2021 The Matrix.org Foundation C.I.C.

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
import { extractRequestError, LogLevel, LogService } from "matrix-bot-sdk";

// !mjolnir powerlevel <user ID> <level> [room]
export async function execSetPowerLevelCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const victim = parts[2];
    const level = Math.round(Number(parts[3]));
    const inRoom = parts[4];

    let targetRooms = inRoom ? [await mjolnir.client.resolveRoom(inRoom)] : Object.keys(mjolnir.protectedRooms);

    for (const targetRoomId of targetRooms) {
        try {
            await mjolnir.client.setUserPowerLevel(victim, targetRoomId, level);
        } catch (e) {
            const message = e.message || (e.body ? e.body.error : '<no message>');
            await mjolnir.logMessage(LogLevel.ERROR, "SetPowerLevelCommand", `Failed to set power level of ${victim} to ${level} in ${targetRoomId}: ${message}`, targetRoomId);
            LogService.error("SetPowerLevelCommand", extractRequestError(e));
        }
    }

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
