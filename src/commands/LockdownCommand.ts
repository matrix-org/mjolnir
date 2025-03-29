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

import { MatrixSendClient } from "../MatrixEmitter";
import { Mjolnir } from "../Mjolnir";
import { JoinRulesEventContent, LogLevel, LogService } from "@vector-im/matrix-bot-sdk";

export const LOCKDOWN_EVENT_TYPE = "org.matrix.mjolnir.lockdown";

// !mjolnir lockdown [roomId]
export async function execLockdownCommand(managementRoomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const lockOrUnlock = parts[2]?.toLocaleLowerCase();
    const target = parts[3];

    if (!["lock", "unlock"].includes(lockOrUnlock)) {
        throw Error("Command must be lock or unlock");
    }

    let targetRooms: string[];
    if (target) {
        const targetRoomId = await mjolnir.client.resolveRoom(target);
        targetRooms = [targetRoomId];
    } else if (mjolnir.config.protectAllJoinedRooms) {
        targetRooms = await mjolnir.client.getJoinedRooms();
    } else {
        targetRooms = mjolnir.protectedRoomsConfig.getExplicitlyProtectedRooms();
    }

    if (!targetRooms.length) {
        await mjolnir.managementRoomOutput.logMessage(LogLevel.INFO, "LockdownCommand", "No protected rooms found");
        return;
    }
    await mjolnir.managementRoomOutput.logMessage(
        LogLevel.INFO,
        "LockdownCommand",
        target ? `Locking down room` : "Locking down ALL protected rooms",
    );
    await mjolnir.client.unstableApis.addReactionToEvent(managementRoomId, event["event_id"], "⏳");
    let didError = false;
    for (const roomId of targetRooms) {
        try {
            await ensureLockdownState(mjolnir.client, roomId, lockOrUnlock === "lock");
        } catch (ex) {
            mjolnir.managementRoomOutput.logMessage(
                LogLevel.ERROR,
                "Lock Command",
                `There was an error locking ${target}, please check the logs for more information.`,
            );
            LogService.error("LockdownCommand", `Error changing lockdown state of ${roomId}:`, ex);
            didError = true;
            await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "❌");
        }
    }

    if (!didError) {
        await mjolnir.client.unstableApis.addReactionToEvent(managementRoomId, event["event_id"], "✅");
    }
}

async function ensureLockdownState(client: MatrixSendClient, roomId: string, lockdown: boolean) {
    const currentState = await client.getSafeRoomAccountData<
        { locked: false } | { locked: true; previousState: JoinRulesEventContent }
    >(LOCKDOWN_EVENT_TYPE, roomId, { locked: false });
    const currentJoinRule = (await client.getRoomStateEvent(roomId, "m.room.join_rules", "")) as JoinRulesEventContent;
    if (!currentState.locked && lockdown) {
        const newState = {
            locked: true,
            previousState: currentJoinRule,
        };
        await client.sendStateEvent(roomId, "m.room.join_rules", "", {
            join_rule: "invite",
        });
        await client.setRoomAccountData(LOCKDOWN_EVENT_TYPE, roomId, newState);
    } else if (currentState.locked && !lockdown) {
        const newState = {
            locked: false,
        };
        await client.sendStateEvent(roomId, "m.room.join_rules", "", currentState.previousState);
        await client.setRoomAccountData(LOCKDOWN_EVENT_TYPE, roomId, newState);
    }
    // Else, nothing to do.
}
