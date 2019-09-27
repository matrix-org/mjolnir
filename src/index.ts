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
    Permalinks,
    RichConsoleLogger,
    SimpleFsStorageProvider
} from "matrix-bot-sdk";
import config from "./config";
import BanList, { ALL_RULE_TYPES } from "./BanList";

LogService.setLogger(new RichConsoleLogger());

const storage = new SimpleFsStorageProvider(path.join(config.dataPath, "bot.json"));
const client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);
const lists: BanList[] = [];
let managementRoomId = "";

if (config.autojoin) {
    AutojoinRoomsMixin.setupOnClient(client);
}

client.on("room.event", async (roomId, event) => {
    if (!event['state_key']) return; // we also don't do anything with state events that have no state key

    if (ALL_RULE_TYPES.includes(event['type'])) {
        for (const list of lists) {
            if (list.roomId !== roomId) continue;
            await list.updateList();
            // TODO: Re-apply ACLs as needed
        }
    } else if (event['type'] === "m.room.member") {
        // TODO: Check membership against ban lists
    }
});

client.on("room.message", async (roomId, event) => {
    if (!event['content']) return;

    const content = event['content'];
    if (content['msgtype'] === "m.text" && content['body'] === "!mjolnir") {
        await client.sendReadReceipt(roomId, event['event_id']);
        return printStatus(roomId);
    }
});


(async function () {
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
        lists.push(list);
    }

    // Ensure we're also in the management room
    managementRoomId = await client.joinRoom(config.managementRoom);
    await client.sendNotice(managementRoomId, "Mjolnir is starting up. Use !mjolnir to query status.");

    // TODO: Check permissions for mjolnir in protected rooms
    // TODO: Complain about permission changes in protected rooms (including after power levels change)

    await client.start();
    LogService.info("index", "Bot started!")
})();

async function printStatus(roomId: string) {
    const rooms = await client.getJoinedRooms();

    let html = "";
    let text = "";

    // Append header information first
    html += "<b>Running: </b>✅<br/>";
    text += "Running: ✅\n";
    html += `<b>Protected rooms: </b> ${rooms.length}<br/>`;
    text += `Protected rooms: ${rooms.length}\n`;

    // Append list information
    html += "<b>Subscribed lists:</b><br><ul>";
    text += "Subscribed lists:\n";
    for (const list of lists) {
        html += `<li><a href="${list.roomRef}">${list.roomId}</a> (${list.rules.length} rules)</li>`;
        text += `${list.roomRef} (${list.rules.length} rules)\n`;
    }
    html += "</ul>";

    const message = {
        msgtype: "m.notice",
        body: text,
        format: "org.matrix.custom.html",
        formatted_body: html,
    };
    return client.sendMessage(roomId, message);
}
