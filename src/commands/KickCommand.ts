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
import { LogLevel, MatrixGlob, RichReply } from "matrix-bot-sdk";
import config from "../config";

// !mjolnir kick <user|filter> [room] [reason]
export async function execKickCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    let force = false;

    const glob = parts[2];
    let rooms = [...Object.keys(mjolnir.protectedRooms)];

    if (parts[parts.length - 1] === "--force") {
        force = true;
        parts.pop();
    }

    if (config.commands.confirmWildcardBan && /[*?]/.test(glob) && !force) {
        let replyMessage = "Wildcard bans require an addition `--force` argument to confirm";
        const reply = RichReply.createFor(roomId, event, replyMessage, replyMessage);
        reply["msgtype"] = "m.notice";
        await mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    const kickRule = new MatrixGlob(glob);

    let reason: string | undefined;
    if (parts.length > 3) {
        let reasonIndex = 3;
        if (parts[3].startsWith("#") || parts[3].startsWith("!")) {
            rooms = [await mjolnir.client.resolveRoom(parts[3])];
            reasonIndex = 4;
        }
        reason = parts.slice(reasonIndex).join(' ') || '<no reason supplied>';
    }
    if (!reason) reason = '<none supplied>';

    for (const protectedRoomId of rooms) {
        const members = await mjolnir.client.getRoomMembers(protectedRoomId, undefined, ["join"], ["ban", "leave"]);

        for (const member of members) {
            const victim = member.membershipFor;

            if (kickRule.test(victim)) {
                await mjolnir.logMessage(LogLevel.DEBUG, "KickCommand", `Removing ${victim} in ${protectedRoomId}`, protectedRoomId);

                if (!config.noop) {
                    try {
                        await mjolnir.taskQueue.push(async () => {
                            return mjolnir.client.kickUser(victim, protectedRoomId, reason);
                        });
                    } catch (e) {
                        await mjolnir.logMessage(LogLevel.WARN, "KickCommand", `An error happened while trying to kick ${victim}: ${e}`);
                    }
                } else {
                    await mjolnir.logMessage(LogLevel.WARN, "KickCommand", `Tried to kick ${victim} in ${protectedRoomId} but the bot is running in no-op mode.`, protectedRoomId);
                }
            }
        }
    }

    return mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
