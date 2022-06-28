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
import { LogLevel, MatrixGlob, MembershipEvent, RichReply, UserID } from "matrix-bot-sdk";
import config from "../config";
import { ServerAcl } from "../models/ServerAcl";

// !mjolnir kick <user|filter> [room] [reason]
export async function execKickCommand(commandRoomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const force = parts[parts.length - 1] === "--force";
    const glob = parts[2];
    const kickRule = new MatrixGlob(glob);
    const kickRuleHasGlob = /[*?]/.test(glob);
    const rooms = await (async () => {
        // if they provide a room then use that, otherwise use all protected rooms.
        if (parts.length > 3) {
            if (parts[3].startsWith("#") || parts[3].startsWith("!")) {
                return [await mjolnir.client.resolveRoom(parts[3])];
            }
        }
        return [...Object.keys(mjolnir.protectedRooms)];
    })();
    const reason = (rooms.length === 1 ?
            // we don't forget to remove the `--force` argument from the reason.
            parts.slice(4, force ? -1 : undefined).join(' ') :
            parts.slice(3, force ? -1 : undefined).join(' ')
        )
        || '<no reason supplied>';

    for (const protectedRoomId of rooms) {
        const membersToKick = await filterMembers(
            mjolnir,
            protectedRoomId,
            membership => kickRule.test(membership.membershipFor) ? KickOutcome.Remove : KickOutcome.Keep
        );
        if (kickRuleHasGlob && (!config.commands.confirmWildcardBan || !force)) {
            let replyMessage = `The wildcard command would have removed ${membersToKick.length} ${membersToKick.length === 1 ? 'member' : 'members'} from ${protectedRoomId}`;
            replyMessage += "Wildcard bans need to be explicitly enabled in the config and require an addition `--force` argument to confirm";
            const reply = RichReply.createFor(commandRoomId, event, replyMessage, replyMessage);
            reply["msgtype"] = "m.notice";
            await mjolnir.client.sendMessage(commandRoomId, reply);
            // We don't want to even tell them who is being kicked if it hasn't been enabled.
            if (!config.commands.confirmWildcardBan) {
                return;
            }
        }
        await kickMembers(mjolnir, protectedRoomId, membersToKick, force, reason);
    }

    return mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
}

/**
 * A command to remove users whose server is banned by server ACL from a room.
 * @param commandRoomId The room the command was sent from.
 * @param event The event containing the command.
 * @param mjolnir A mjolnir instance.
 * @param parts The parts of the command.
 * @returns When the users have been removed and the command has been marked as complete.
 */
export async function execServerAclCleanCommand(commandRoomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const force = parts[parts.length - 1] === "--force";
    const serverName: string = new UserID(await mjolnir.client.getUserId()).domain;
    // If they say all, clean all protected rooms, otherwise they gave a room id/alias/pill.
    const roomsToClean = parts[2] === 'all' ? [...Object.keys(mjolnir.protectedRooms)] : [await mjolnir.client.resolveRoom(parts[2])]
    for (const roomToClean of roomsToClean) {
        const currentAcl = new ServerAcl(serverName).fromACL(await mjolnir.client.getRoomStateEvent(roomToClean, "m.room.server_acl", ""));
        const membersToKick = await filterMembers(
            mjolnir,
            roomToClean,
            membership => {
                const memberId = new UserID(membership.membershipFor);
                // check the user's server isn't on the deny list.
                for (const deny of currentAcl.safeAclContent().deny) {
                    const rule = new MatrixGlob(deny);
                    if (rule.test(memberId.domain)) {
                        return KickOutcome.Remove;
                    }
                }
                // check the user's server is allowed.
                for (const allow of currentAcl.safeAclContent().allow) {
                    const rule = new MatrixGlob(allow);
                    if (rule.test(memberId.domain)) {
                        return KickOutcome.Keep;
                    }
                }
                // if they got here it means their server was not explicitly allowed.
                return KickOutcome.Remove;
            }
        );

        /// Instead of having --force on commands like these were confirmation is required after some context,
        /// wouldn't it be better if we showed what would happen and then ask yes/no to confirm?
        if (!force) {
            let replyMessage = `The ACL clean command would have removed ${membersToKick.length} ${membersToKick.length === 1 ? 'member' : 'members'} from ${roomToClean}`;
            replyMessage += "The ACL clean command needs an additional `--force` argument to confirm";
            const reply = RichReply.createFor(commandRoomId, event, replyMessage, replyMessage);
            reply["msgtype"] = "m.notice";
            await mjolnir.client.sendMessage(commandRoomId, reply);
        }
        await kickMembers(mjolnir, roomToClean, membersToKick, force, "User's server is banned by the room's server ACL event.")
    }
    return mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
}

/**
 * Filter room members using a user specified predicate.
 * @param mjolnir Mjolnir instance to fetch room members with.
 * @param roomId The room to fetch members from.
 * @param predicate A function accepting a membership event's content and returns a `KickOutcome`. See `MembershipEvent`.
 * @returns A list of user ids who are members of the room who have been marked as `KickOutcome.Remove`.
 */
async function filterMembers(
    mjolnir: Mjolnir,
    roomId: string,
    predicate: (member: MembershipEvent) => KickOutcome
): Promise<string[]> {
    const members = await mjolnir.client.getRoomMembers(roomId, undefined, ["join"], ["ban", "leave"]);
    const filteredMembers = [];
    for (const member of members) {
        if (predicate(member) === KickOutcome.Remove) {
            filteredMembers.push(member.membershipFor);
        }
    }
    return filteredMembers;
}

/**
 * Whether to remove a user from a room or not.
 */
enum KickOutcome {
    Remove,
    Keep,
}

async function kickMembers(mjolnir: Mjolnir, roomId: string, membersToKick: string[], force: boolean, reason: string) {
    // I do not think it makes much sense to notify who was kicked like this.
    // It should really be reconsidered with https://github.com/matrix-org/mjolnir/issues/294
    // and whether we want to produce reports or something like that.
    for (const member of membersToKick) {
        if (config.noop) {
            await mjolnir.logMessage(LogLevel.WARN, "KickCommand", `Tried to kick ${member} in ${roomId} but the bot is running in no-op mode.`);
        } else if (!force) {
            await mjolnir.logMessage(LogLevel.DEBUG, "KickCommand", `Would have kicked ${member} in ${roomId} but --force was not given with the command.`);
        } else {
            await mjolnir.logMessage(LogLevel.DEBUG, "KickCommand", `Removing ${member} in ${roomId}`);
            try {
                await mjolnir.taskQueue.push(async () => {
                    return mjolnir.client.kickUser(member, roomId, reason);
                });
            } catch (e) {
                await mjolnir.logMessage(LogLevel.WARN, "KickCommand", `An error happened while trying to kick ${member}: ${e}`);
            }
        }
    }
}
