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

import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { newTestUser } from "./clientHelper";
import { getFirstReaction } from "./commands/commandUtils";
import { equal, fail } from "node:assert/strict";

describe("Test: First message is image", function () {
    let modClient: MatrixClient;
    let badClient: MatrixClient;
    let badClientId: string;
    let fineClient: MatrixClient;
    let testRoom: string;
    let mjolnirId: string;
    this.beforeEach(async function () {
        modClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "first-message-is-image-test-moderator" },
        });
        await modClient.start();
        mjolnirId = await this.mjolnir.client.getUserId();

        badClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "first-message-is-image-test-bad-actor" },
        });
        await badClient.start();
        badClientId = await badClient.getUserId();

        fineClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "first-message-is-image-test-safe" },
        });
        await fineClient.start();
        const fineClientId = await fineClient.getUserId();

        testRoom = await modClient.createRoom({ invite: [mjolnirId, badClientId, fineClientId] });
        await modClient.joinRoom(testRoom);
        await modClient.joinRoom(this.config.managementRoom);
        await modClient.setUserPowerLevel(mjolnirId, testRoom, 100);
        await badClient.joinRoom(testRoom);
        await fineClient.joinRoom(testRoom);
    });
    this.afterEach(async function () {
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir disable FirstMessageIsImageProtection`,
            });
        });
        await modClient.stop();
        await badClient.stop();
        await fineClient.stop();
    });

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Bans user who posts image as first message and redacts message if protection enabled", async function () {
        this.timeout(20000);

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable FirstMessageIsImageProtection`,
            });
        });
        let content = { msgtype: "m.image", body: "test.jpeg", url: "mxc://fake_image" };
        let imageMessage = await badClient.sendMessage(testRoom, content);

        await delay(3000);
        const badId = await badClient.getUserId();
        const banEvents = await modClient.getRoomMembersByMembership(testRoom, "ban");
        equal(banEvents.length, 1, "Bad user should be only ban in room.");
        const banEvent = banEvents[0];
        equal(banEvent.stateKey, badId, "Bad user should have been banned.");

        // bad user banned for spam so their events should be redacted
        let processedLink = await modClient.getEvent(testRoom, imageMessage);
        equal(processedLink?.redacted_because?.redacts, imageMessage, "This  event should have been redacted");
    });

    it("Doesn't ban safe messages", async function () {
        this.timeout(20000);

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable FirstMessageIsImageProtection`,
            });
        });
        let fineContent = { msgtype: "m.text", body: "check out my totally cool message" };
        await fineClient.sendMessage(testRoom, fineContent);

        await delay(3000);
        const banEvents = await modClient.getRoomMembersByMembership(testRoom, "ban");
        equal(banEvents.length, 0, "There should be no ban in the room.");

        let goodContent = {
            msgtype: "m.text",
            body: "still talking",
        };
        try {
            await fineClient.sendMessage(testRoom, goodContent);
        } catch (error) {
            fail("User should have been able to send more messages.");
        }
    });
    it("Doesnt ban moderator who posts image as first message", async function () {
        this.timeout(20000);

        const modClientId = await modClient.getUserId();
        // create a new room and have moderator join it
        const newRoom = await badClient.createRoom({ invite: [modClientId, mjolnirId] });
        await modClient.joinRoom(newRoom);
        await this.mjolnir.client.joinRoom(newRoom);
        await modClient.setUserPowerLevel(mjolnirId, testRoom, 100);

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${newRoom}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable FirstMessageIsImageProtection`,
            });
        });
        let content = { msgtype: "m.image", body: "test.jpeg", url: "mxc://fake_image" };
        let imageMessage = await modClient.sendMessage(testRoom, content);

        await delay(3000);
        const banEvents = await modClient.getRoomMembersByMembership(newRoom, "ban");
        equal(banEvents.length, 0, "There should be no bans in the room.");

        // mod should not have been banned so event should not have been redacted
        let processedImage = await modClient.getEvent(testRoom, imageMessage);
        equal(Object.keys(processedImage.content), 3, "This  event should not have been redacted");
    });
});
