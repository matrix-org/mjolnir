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

import { MatrixClient, RoomCreateOptions } from "@vector-im/matrix-bot-sdk";
import { read as configRead } from "../../../src/config";
import { newTestUser } from "../clientHelper";
import { strict as assert } from "assert";
import { getFirstReaction } from "./commandUtils";

describe("Test: lock/unlock command", function () {
    let admin: MatrixClient;
    let badUser: MatrixClient;
    let badUserId: string;
    const config = configRead();
    this.beforeEach(async () => {
        admin = await newTestUser(config.homeserverUrl, { name: { contains: "lock-command-admin" } });
        await admin.start();
        badUser = await newTestUser(config.homeserverUrl, { name: { contains: "bad-user" } });
        await badUser.start();
        badUserId = await badUser.getUserId();
    });
    this.afterEach(async function () {
        admin.stop();
        badUser.stop();
    });

    it("Mjolnir asks synapse to lock and unlock a user", async function () {
        this.timeout(20000);
        await admin.joinRoom(this.mjolnir.managementRoomId);
        const roomOption: RoomCreateOptions = { preset: "public_chat" };
        const room = await admin.createRoom(roomOption);
        await badUser.joinRoom(room);
        await admin.joinRoom(room);
        const badUserID = await badUser.getUserId();

        await getFirstReaction(admin, this.mjolnir.managementRoomId, "✅", async () => {
            return await admin.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir lock ${badUserID}`,
            });
        });

        // locked user can't send message
        try {
            await badUser.sendMessage(room, { msgtype: "m.text", body: `testing` });
            assert.fail("Bad user successfully sent message.");
        } catch (error: any) {
            assert.match(error.message, /M_USER_LOCKED/i);
        }

        await getFirstReaction(admin, this.mjolnir.managementRoomId, "✅", async () => {
            return await admin.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir unlock ${badUserID}`,
            });
        });

        let msg = new Promise(async (resolve, reject) => {
            await badUser.sendMessage(room, { msgtype: "m.text", body: `testing` });
            admin.on("room.event", (roomId, event) => {
                if (
                    roomId === room &&
                    event?.type === "m.room.message" &&
                    event.sender === badUserId &&
                    event.content?.body === "testing"
                ) {
                    resolve(event);
                }
            });
        });
        // unlocked user successfully sent message
        await msg;
    });
});
