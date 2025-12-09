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
import { readFileSync } from "fs";
import { equal } from "node:assert/strict";

describe("Test: Message is video", function () {
    let moderator: MatrixClient;
    let spammer: MatrixClient;
    let testRoom: string;
    this.beforeEach(async function () {
        moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "message-is-video" } });
        spammer = await newTestUser(this.config.homeserverUrl, { name: { contains: "message-is-video-spammer" } });
        await moderator.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        const spammerId = await spammer.getUserId();
        testRoom = await moderator.createRoom({ invite: [mjolnirId, spammerId] });
        await moderator.joinRoom(testRoom);
        await spammer.joinRoom(testRoom);
        await moderator.joinRoom(this.config.managementRoom);
        await moderator.setUserPowerLevel(mjolnirId, testRoom, 100);
    });
    this.afterEach(async function () {
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir disable MessageIsVideoProtection`,
            });
        });
        await moderator.stop();
    });

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Redacts all messages that are video msgtype if protection enabled", async function () {
        this.timeout(20000);

        await moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable MessageIsVideoProtection`,
            });
        });
        const data = readFileSync("test_tree.jpg");
        const mxc = await spammer.uploadContent(data, "image/png");

        // use a bogus mxc for video message as it doesn't matter for this test
        let videoContent = { msgtype: "m.video", body: "some_file.mp4", url: mxc };
        let videoMessage = await spammer.sendMessage(testRoom, videoContent);

        await delay(3000);
        let processedVideo = await spammer.getEvent(testRoom, videoMessage);
        equal(processedVideo?.redacted_because?.redacts, videoMessage, "This  event should have been redacted");
    });

    it("Doesn't redact massages that are not video.", async function () {
        this.timeout(20000);

        await moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable MessageIsVideoProtection`,
            });
        });

        let content = { msgtype: "m.text", body: "don't redact me bro" };
        let textMessage = await spammer.sendMessage(testRoom, content);

        await delay(500);
        let processedMessage = await spammer.getEvent(testRoom, textMessage);
        equal(Object.keys(processedMessage.content).length, 2, "This event should not have been redacted.");
    });

    it("Doesn't redact messages that are video msgtype if sender is member of management room", async function () {
        this.timeout(20000);

        await moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable MessageIsVideoProtection`,
            });
        });

        // use a bogus mxc for video message as it doesn't matter for this test
        let videoContent = { msgtype: "m.video", body: "some_file.mp4", url: "mxc://server/doesntmatter" };
        let videoMessage = await moderator.sendMessage(testRoom, videoContent);

        await delay(3000);
        let processedVideo = await moderator.getEvent(testRoom, videoMessage);
        equal(Object.keys(processedVideo.content).length, 3, "This event should not have been redacted.");
    });
});
