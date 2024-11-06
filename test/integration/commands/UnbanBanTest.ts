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

import { strict as assert } from "assert";

import { newTestUser, noticeListener } from "../clientHelper";
import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";

describe("Test: UnBan function", function () {
    let moderator: MatrixClient;
    let testRoom: string;
    let badUser: MatrixClient;
    let badId: string;
    this.beforeEach(async function () {
        moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "unban-test-moderator" } });
        badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "unban-test-bad-user" } });
        badId = await badUser.getUserId();
        await moderator.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        testRoom = await moderator.createRoom({ preset: "public_chat" });
        await moderator.joinRoom(this.config.managementRoom);
        await this.mjolnir.client.joinRoom(testRoom);
        await badUser.joinRoom(testRoom);
        await moderator.setUserPowerLevel(mjolnirId, testRoom, 100);

        await moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir list create COC code-of-conduct-ban-list-2`,
        });
        let reply: Promise<any> = new Promise((resolve, reject) => {
            moderator.on(
                "room.message",
                noticeListener(this.mjolnir.managementRoomId, (event) => {
                    if (event.content.body.includes("Created new list")) {
                        resolve(event);
                    }
                }),
            );
        });
        await reply;

        moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
    });
    this.afterEach(async function () {
        // unwatch coc
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir unwatch #code-of-conduct-ban-list-2:localhost:9999`,
            });
        });
        // remove alias
        await this.mjolnir.client.deleteRoomAlias("#code-of-conduct-ban-list-2:localhost:9999");
        await moderator.stop();
    });
    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Unban command unbans user when requested", async function () {
        this.timeout(20000);
        await badUser.sendMessage(testRoom, { msgtype: "m.text", body: "spammy spam" });

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir ban COC ${badId} spam`,
            });
        });
        await delay(1000);
        // verify that user is banned
        const membership = await moderator.getRoomStateEvent(testRoom, "m.room.member", badId);
        assert.equal(membership["membership"], "ban");

        // use unban command
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir unban COC user ${badId} true`,
            });
        });

        await delay(1000);
        // verify that they can join room
        await badUser.joinRoom(testRoom);

        // and send messages without being redacted
        const newMessageId = await badUser.sendMessage(testRoom, {
            msgtype: "m.text",
            body: "I am no longer redacted",
        });
        const fetchedEvent = await moderator.getEvent(testRoom, newMessageId);
        assert.equal(Object.keys(fetchedEvent.content).length, 2, "This event should not have been redacted");
    });

    it("Unban command removes user from autoredact list when banned via protection", async function () {
        this.timeout(20000);

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable BasicFloodingProtection`,
            });
        });

        let messageId!: string;
        for (let i = 0; i < 11; i++) {
            messageId = await badUser.sendMessage(testRoom, { msgtype: "m.text", body: "spam content" });
        }
        await delay(1000);
        // verify they've been banned
        const membership = await moderator.getRoomStateEvent(testRoom, "m.room.member", badId);
        assert.equal(membership["membership"], "ban");

        // verify they're being redacted
        let redactedMessage = await moderator.getEvent(testRoom, messageId);
        assert.equal(Object.keys(redactedMessage.content).length, 0, "This event should have been redacted.");

        // check that they are in the autoredact queue as well
        const inQueue = this.mjolnir.unlistedUserRedactionHandler.isUserQueued(badId);
        assert.equal(inQueue, true);

        // use unban command
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir unban COC user ${badId} true`,
            });
        });

        // test that unbanned user can join room
        await badUser.joinRoom(testRoom);

        // and send events without being redacted
        const newMessageId = await badUser.sendMessage(testRoom, {
            msgtype: "m.text",
            body: "I am no longer redacted",
        });
        const fetchedEvent = await moderator.getEvent(testRoom, newMessageId);
        assert.equal(Object.keys(fetchedEvent.content).length, 2, "This event should not have been redacted");

        // and are no longer in autoredact queue
        const stillInQueue = this.mjolnir.unlistedUserRedactionHandler.isUserQueued(badId);
        assert.equal(stillInQueue, false);
    });
});
