/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { newTestUser } from "../clientHelper";
import { strict as assert } from "assert";
import { MatrixClient, RoomCreateOptions } from "@vector-im/matrix-bot-sdk";
import { read as configRead } from "../../../src/config";

describe("Test: suspend/unsuspend command", function () {
    let admin: MatrixClient;
    let badUser: MatrixClient;
    const config = configRead();
    this.beforeEach(async () => {
        admin = await newTestUser(config.homeserverUrl, { name: { contains: "suspend-command" } });
        await admin.start();
        badUser = await newTestUser(config.homeserverUrl, { name: { contains: "bad-user" } });
        await badUser.start();
    });
    this.afterEach(async function () {
        admin.stop();
        badUser.stop();
    });

    it("Mjolnir asks synapse to suspend and unsuspend a user", async function () {
        this.timeout(20000);
        await admin.joinRoom(this.mjolnir.managementRoomId);
        const roomOption: RoomCreateOptions = { preset: "public_chat" };
        const room = await admin.createRoom(roomOption);
        await badUser.joinRoom(room);
        await admin.joinRoom(room);
        const badUserID = await badUser.getUserId();

        let reply = new Promise(async (resolve, reject) => {
            await admin.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir suspend ${badUserID}`,
            });
            admin.on("room.event", (roomId, event) => {
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event?.type === "m.room.message" &&
                    event.sender === this.mjolnir.client.userId &&
                    event.content?.body.endsWith(`User ${badUserID} has been suspended.`)
                ) {
                    resolve(event);
                }
            });
        });

        await reply;
        try {
            await badUser.sendMessage(room, { msgtype: "m.text", body: `testing` });
            assert.fail("Bad user successfully sent message.");
        } catch (error) {
            assert.match(error.message, /M_USER_SUSPENDED/i);
        }

        let reply2 = new Promise(async (resolve, reject) => {
            await admin.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir unsuspend ${badUserID}`,
            });
            admin.on("room.event", (roomId, event) => {
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event?.type === "m.room.message" &&
                    event.sender === this.mjolnir.client.userId &&
                    event.content?.body.endsWith(`User ${badUserID}'s suspension has been reversed.`)
                ) {
                    resolve(event);
                }
            });
        });
        await reply2;

        try {
            await badUser.sendMessage(room, { msgtype: "m.text", body: `testing` });
        } catch (error) {
            assert.fail("Unable to send message, account not successfully unsuspended.");
        }
    });
});
