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

import * as path from "path";
import {
    LogLevel,
    LogService,
    MatrixClient,
    PantalaimonClient,
    Permalinks,
    RichConsoleLogger,
    SimpleFsStorageProvider
} from "matrix-bot-sdk";
import config from "./config";
import BanList from "./models/BanList";
import { Mjolnir } from "./Mjolnir";
import { logMessage } from "./LogProxy";
import { MembershipEvent } from "matrix-bot-sdk/lib/models/events/MembershipEvent";
import { BanListServer } from "./server/BanListServer";
import * as htmlEscape from "escape-html";

config.RUNTIME = {client: null};

LogService.setLogger(new RichConsoleLogger());
LogService.setLevel(LogLevel.fromString(config.logLevel, LogLevel.DEBUG));

LogService.info("index", "Starting bot...");

(async function () {
    const storage = new SimpleFsStorageProvider(path.join(config.dataPath, "bot.json"));

    let client: MatrixClient;
    if (config.pantalaimon.use) {
        const pantalaimon = new PantalaimonClient(config.homeserverUrl, storage);
        client = await pantalaimon.createClientWithCredentials(config.pantalaimon.username, config.pantalaimon.password);
    } else {
        client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);
    }

    config.RUNTIME.client = client;

    client.on("room.invite", async (roomId: string, inviteEvent: any) => {
        const membershipEvent = new MembershipEvent(inviteEvent);

        const reportInvite = async () => {
            if (!config.recordIgnoredInvites) return; // Nothing to do

            await client.sendMessage(config.managementRoom, {
                msgtype: "m.text",
                body: `${membershipEvent.sender} has invited me to ${roomId} but the config prevents me from accepting the invitation. `
                    + `If you would like this room protected, use "!mjolnir rooms add ${roomId}" so I can accept the invite.`,
                format: "org.matrix.custom.html",
                formatted_body: `${htmlEscape(membershipEvent.sender)} has invited me to ${htmlEscape(roomId)} but the config prevents me from `
                    + `accepting the invitation. If you would like this room protected, use <code>!mjolnir rooms add ${htmlEscape(roomId)}</code> `
                    + `so I can accept the invite.`,
            });
        };

        if (config.autojoinOnlyIfManager) {
            const managers = await client.getJoinedRoomMembers(config.managementRoom);
            if (!managers.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
        } else {
            const groupMembers = await client.unstableApis.getGroupUsers(config.acceptInvitesFromGroup);
            const userIds = groupMembers.map(m => m.user_id);
            if (!userIds.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
        }

        return client.joinRoom(roomId);
    });

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

    const bot = new Mjolnir(client, protectedRooms, banLists);

    if (config.banListServer && config.banListServer.enabled) {
        const server = new BanListServer(bot);
        await server.start();
    }

    await bot.start();
})();
