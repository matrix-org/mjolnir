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
    AutojoinRoomsMixin,
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

LogService.setLogger(new RichConsoleLogger());

(async function () {
    const storage = new SimpleFsStorageProvider(path.join(config.dataPath, "bot.json"));

    let client: MatrixClient;
    if (config.pantalaimon.use) {
        const pantalaimon = new PantalaimonClient(config.homeserverUrl, storage);
        client = await pantalaimon.createClientWithCredentials(config.pantalaimon.username, config.pantalaimon.password);
    } else {
        client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);
    }

    if (config.autojoin) {
        AutojoinRoomsMixin.setupOnClient(client);
    }

    const banLists: BanList[] = [];
    const protectedRooms: { [roomId: string]: string } = {};

    // Ensure we're in all the rooms we expect to be in
    const joinedRooms = await client.getJoinedRooms();
    for (const roomRef of config.banLists) {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) continue;

        const roomId = await client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            await client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
        }

        const list = new BanList(roomId, roomRef, client);
        await list.updateList();
        banLists.push(list);
    }

    // Ensure we're also joined to the rooms we're protecting
    for (const roomRef of config.protectedRooms) {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) continue;

        let roomId = await client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            roomId = await client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
        }

        protectedRooms[roomId] = roomRef;
    }

    // Ensure we've joined the ban list we're publishing too
    let banListRoomId = await client.resolveRoom(config.publishedBanListRoom);
    if (!joinedRooms.includes(banListRoomId)) {
        banListRoomId = await client.joinRoom(config.publishedBanListRoom);
    }

    // Ensure we're also in the management room
    const managementRoomId = await client.joinRoom(config.managementRoom);
    await client.sendNotice(managementRoomId, "Mjolnir is starting up. Use !mjolnir to query status.");

    const bot = new Mjolnir(client, managementRoomId, banListRoomId, protectedRooms, banLists);
    await bot.start();

    LogService.info("index", "Bot started!")
})();
