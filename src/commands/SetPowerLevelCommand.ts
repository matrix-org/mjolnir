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
import { extractRequestError, LogLevel, LogService } from "@vector-im/matrix-bot-sdk";

// !mjolnir powerlevel <user ID> <level> [room]
export async function execSetPowerLevelCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const target = parts[2];
    const level = Math.round(Number(parts[3]));
    const inRoom = parts[4];

    const mjolnirId = await mjolnir.client.getUserId();

    let targetRooms = inRoom
        ? [await mjolnir.client.resolveRoom(inRoom)]
        : mjolnir.protectedRoomsTracker.getProtectedRooms();

    let force = false;
    if (parts[parts.length - 1] === "--force") {
        force = true;
        parts.pop();
    }

    for (const targetRoomId of targetRooms) {
        try {
            const currentLevels = await mjolnir.client.getRoomStateEvent(targetRoomId, "m.room.power_levels", "");
            const currentLevel = currentLevels["users"][mjolnirId];
            if (!force) {
                if (mjolnir.moderators.checkMembership(target)) {
                    // don't let the bot demote members of moderation room without --force arg
                    if (level < currentLevel) {
                        await mjolnir.managementRoomOutput.logMessage(
                            LogLevel.INFO,
                            "PowerLevelCommand",
                            `You are attempting to lower the bot/a moderator's power level: current level ${currentLevel}, requested level ${level}, aborting. This check can be overriden with a --force argument at the end of the command.`,
                        );
                        return;
                    }
                }
            }
            if (target === mjolnirId && level < currentLevel) {
                await mjolnir.managementRoomOutput.logMessage(
                    LogLevel.INFO,
                    "PowerLevelCommand",
                    `You are attempting to lower the bot power level: current level ${currentLevel}, requested level ${level}, aborting.`,
                );
                return;
            }
            await mjolnir.client.setUserPowerLevel(target, targetRoomId, level);
        } catch (e) {
            const message = e.message || (e.body ? e.body.error : "<no message>");
            await mjolnir.managementRoomOutput.logMessage(
                LogLevel.ERROR,
                "SetPowerLevelCommand",
                `Failed to set power level of ${target} to ${level} in ${targetRoomId}: ${message}`,
                targetRoomId,
            );
            LogService.error("SetPowerLevelCommand", extractRequestError(e));
        }
    }

    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
}
