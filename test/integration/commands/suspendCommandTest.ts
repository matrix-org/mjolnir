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
import { MatrixClient, MXCUrl, RoomCreateOptions } from "@vector-im/matrix-bot-sdk";
import { read as configRead } from "../../../src/config";
import { getFirstReaction } from "./commandUtils";
import { randomUUID } from "crypto";

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

    it("Correctly quarantines media after suspending user", async function () {
        this.timeout(30000);
        const badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer" } });
        const mjolnir: MatrixClient = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();
        const badUserId = await badUser.getUserId();
        const someFakeMedia = await badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain");
        const { mediaId } = MXCUrl.parse(someFakeMedia);

        await admin.joinRoom(this.config.managementRoom);
        let targetRoom = await admin.createRoom({
            invite: [await badUser.getUserId(), mjolnirUserId],
            power_level_content_override: {
                users: {
                    [mjolnirUserId]: 100,
                    [await admin.getUserId()]: 100,
                },
            },
        });

        await getFirstReaction(admin, this.mjolnir.managementRoomId, "✅", async () => {
            return await admin.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir rooms add ${targetRoom}`,
            });
        });

        await badUser.joinRoom(targetRoom);
        await badUser.sendMessage(targetRoom, {
            msgtype: "m.text",
            body: someFakeMedia,
        });

        await new Promise(async (resolve) => {
            await admin.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir suspend ${badUserId} --quarantine`,
            });
            admin.on("room.event", (roomId, event) => {
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event?.type === "m.room.message" &&
                    event.sender === this.mjolnir.client.userId &&
                    event.content?.body.endsWith(
                        `User ${badUserId} has been suspended. 1 media items were quarantined.`,
                    )
                ) {
                    resolve(event);
                }
            });
        });

        const { media } = await mjolnir.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(badUserId)}/media`,
        );
        assert.equal(media[0].media_id, mediaId);
        assert.equal(media[0].quarantined_by, mjolnirUserId);
    });
});
