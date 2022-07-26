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
import { Command, Lexer } from "./Command";
import { Token } from "tokenizr";

export class KickCommand implements Command {
    command: "kick";
    helpArgs: "<glob> [room alias/ID] [reason]";
    helpDescription: "Kicks a user or all of those matching a glob in a particular room or all protected rooms";
    async exec(mjolnir: Mjolnir, commandRoomId: string, lexer: Lexer, event: any): Promise<void> {

        // Parse command-line args.
        let globUserID = lexer.token("globUserID").text;
        let roomAliasOrIDToken: Token | null = lexer.alternatives(
            () => lexer.token("roomAliasOrID"),
            () => null,
        );
        let reason = lexer.alternatives(
            () => lexer.token("string"),
            () => lexer.token("ETC")
        ).text as string;

        const ARG_FORCE = "--force";
        let hasForce = !config.commands.confirmWildcardBan;
        if (reason.endsWith(ARG_FORCE)) {
            reason = reason.slice(undefined, ARG_FORCE.length);
            hasForce = true;
        }
        if (reason.trim().length == 0) {
            reason = "<no reason supplied>";
        }

        // Validate args.
        if (!hasForce && /[*?]/.test(globUserID)) {
            let replyMessage = "Wildcard bans require an addition `--force` argument to confirm";
            const reply = RichReply.createFor(commandRoomId, event, replyMessage, replyMessage);
            reply["msgtype"] = "m.notice";
            await mjolnir.client.sendMessage(commandRoomId, reply);
            return;
        }

        // Compute list of rooms.
        let rooms;
        if (roomAliasOrIDToken) {
            rooms = [await mjolnir.client.resolveRoom(roomAliasOrIDToken.text)];
        } else {
            rooms = [...Object.keys(mjolnir.protectedRooms)];
        }

        // Proceed.
        const kickRule = new MatrixGlob(globUserID);

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
    
        await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
    }
}
