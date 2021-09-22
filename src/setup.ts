/*
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

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

import { LogLevel, LogService, MatrixClient, Permalinks } from "matrix-bot-sdk";
import { MembershipEvent } from "matrix-bot-sdk/lib/models/events/MembershipEvent";
import * as htmlEscape from "escape-html";
import BanList from "./models/BanList";
import { logMessage } from "./LogProxy";
import { Mjolnir } from "./Mjolnir";

/**
 * Adds a listener to the client that will automatically accept invitations.
 * @param {MatrixClient} client 
 * @param options By default accepts invites from anyone.
 * @param {string} options.managementRoom The room to report ignored invitations to if `recordIgnoredInvites` is true.
 * @param {boolean} options.recordIgnoredInvites Whether to report invites that will be ignored to the `managementRoom`.
 * @param {boolean} options.autojoinOnlyIfManager Whether to only accept an invitation by a user present in the `managementRoom`.
 * @param {string} options.acceptInvitesFromGroup A group of users to accept invites from, ignores invites form users not in this group.
 */
export function addJoinOnInviteListener(client: MatrixClient, options) {
    client.on("room.invite", async (roomId: string, inviteEvent: any) => {
        const membershipEvent = new MembershipEvent(inviteEvent);

        const reportInvite = async () => {
            if (!options.recordIgnoredInvites) return; // Nothing to do

            await client.sendMessage(options.managementRoom, {
                msgtype: "m.text",
                body: `${membershipEvent.sender} has invited me to ${roomId} but the config prevents me from accepting the invitation. `
                    + `If you would like this room protected, use "!mjolnir rooms add ${roomId}" so I can accept the invite.`,
                format: "org.matrix.custom.html",
                formatted_body: `${htmlEscape(membershipEvent.sender)} has invited me to ${htmlEscape(roomId)} but the config prevents me from `
                    + `accepting the invitation. If you would like this room protected, use <code>!mjolnir rooms add ${htmlEscape(roomId)}</code> `
                    + `so I can accept the invite.`,
            });
        };

        if (options.autojoinOnlyIfManager) {
            const managers = await client.getJoinedRoomMembers(options.managementRoom);
            if (!managers.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
        } else {
            const groupMembers = await client.unstableApis.getGroupUsers(options.acceptInvitesFromGroup);
            const userIds = groupMembers.map(m => m.user_id);
            if (!userIds.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
        }

        return client.joinRoom(roomId);
    });
}

export async function setupMjolnir(client, config): Promise<Mjolnir> {
    addJoinOnInviteListener(client, config);

    const banLists: BanList[] = [];
    const protectedRooms: { [roomId: string]: string } = {};
    const joinedRooms = await client.getJoinedRooms();
    // Ensure we're also joined to the rooms we're protecting
    LogService.info("index", "Resolving protected rooms...");
    for (const roomRef of config.protectedRooms) {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) continue;

        let roomId = await client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            roomId = await client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
        }

        protectedRooms[roomId] = roomRef;
    }

    // Ensure we're also in the management room
    LogService.info("index", "Resolving management room...");
    const managementRoomId = await client.resolveRoom(config.managementRoom);
    if (!joinedRooms.includes(managementRoomId)) {
        config.managementRoom = await client.joinRoom(config.managementRoom);
    } else {
        config.managementRoom = managementRoomId;
    }
    await logMessage(LogLevel.INFO, "index", "Mjolnir is starting up. Use !mjolnir to query status.");

    return new Mjolnir(client, protectedRooms, banLists);
}