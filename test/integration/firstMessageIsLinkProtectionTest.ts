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
import { strict as assert } from "assert";
import { findLink } from "../../src/utils";

describe("Test: First message is link", function () {
    let modClient: MatrixClient;
    let badClient: MatrixClient;
    let badClientId: string;
    let fineClient: MatrixClient;
    let testRoom: string;
    this.beforeEach(async function () {
        modClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "first-message-is-link-test-moderator" },
        });
        await modClient.start();
        const mjolnirId = await this.mjolnir.client.getUserId();

        badClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "first-message-is-link-test-bad-actor" },
        });
        await badClient.start();
        badClientId = await badClient.getUserId();

        fineClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "first-message-is-link-test-safe" },
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
                body: `!mjolnir disable FirstMessageIsLinkProtection`,
            });
        });
        await modClient.stop();
        await badClient.stop();
        await fineClient.stop();
    });

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Bans user who posts link as first message if protection enabled", async function () {
        this.timeout(20000);

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable FirstMessageIsLinkProtection`,
            });
        });
        let linkContent = { msgtype: "m.text", body: "check out www.spam.org" };
        let linkMessage = await badClient.sendMessage(testRoom, linkContent);

        await delay(3000);
        const badId = await badClient.getUserId();
        const banEvents = await modClient.getRoomMembersByMembership(testRoom, "ban");
        assert.equal(banEvents.length, 1, "Bad user should be only ban in room.");
        const banEvent = banEvents[0];
        assert.equal(banEvent.stateKey, badId, "Bad user should have been banned.");

        // bad user banned for spam so their events should be redacted
        let processedLink = await modClient.getEvent(testRoom, linkMessage);
        assert.equal(processedLink?.redacted_because?.redacts, linkMessage, "This  event should have been redacted");
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
                body: `!mjolnir enable FirstMessageIsLinkProtection`,
            });
        });
        let fineContent = { msgtype: "m.text", body: "check out my totally cool message" };
        await fineClient.sendMessage(testRoom, fineContent);

        await delay(3000);
        const banEvents = await modClient.getRoomMembersByMembership(testRoom, "ban");
        assert.equal(banEvents.length, 0, "There should be no ban in the room.");

        let goodContent = {
            msgtype: "m.text",
            body: "still talking",
        };
        try {
            await fineClient.sendMessage(testRoom, goodContent);
        } catch (error) {
            assert.fail("User should have been able to send more messages.");
        }
    });
    it("picks up links but not acceptable messages", async function () {
        assert.equal(findLink("https://www.example.com"), true);
        assert.equal(findLink("http://subdomain.example.co.uk/path?query=value#hash"), true);
        assert.equal(findLink("www.example.com"), true);
        assert.equal(findLink("domain.com/spamspam"), true);

        assert.equal(findLink("not a link"), false);
        assert.equal(findLink("invalid url: example"), false);
        assert.equal(findLink(" "), false);
        assert.equal(findLink("@something:matrix"), false);
    });
});
