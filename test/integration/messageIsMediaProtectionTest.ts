import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { newTestUser } from "./clientHelper";
import { getFirstReaction } from "./commands/commandUtils";
import { readFileSync } from "fs";
import { strict as assert } from "assert";

describe("Test: Message is media", function () {
    let client: MatrixClient;
    let testRoom: string;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "message-is-media" } });
        await client.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        testRoom = await client.createRoom({ invite: [mjolnirId] });
        await client.joinRoom(testRoom);
        await client.joinRoom(this.config.managementRoom);
        await client.setUserPowerLevel(mjolnirId, testRoom, 100);
    });
    this.afterEach(async function () {
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir disable MessageIsMediaProtection`,
            });
        });
        await client.stop();
    });

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Redacts all messages that are media if protection enabled", async function () {
        this.timeout(20000);

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable MessageIsMediaProtection`,
            });
        });
        const data = readFileSync("test_tree.jpg");
        const mxc = await client.uploadContent(data, "image/png");
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await client.sendMessage(testRoom, content);

        let formatted_body = `<img src=${mxc} />`;
        let htmlContent = {
            msgtype: "m.image",
            body: formatted_body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        let htmlMessage = await client.sendMessage(testRoom, htmlContent);

        // use a bogus mxc for video message as it doesn't matter for this test
        let videoContent = { msgtype: "m.video", body: "some_file.mp4", url: mxc };
        let videoMessage = await client.sendMessage(testRoom, videoContent);

        await delay(700);
        let processedImage = await client.getEvent(testRoom, imageMessage);
        assert.equal(Object.keys(processedImage.content).length, 0, "This event should have been redacted.");

        let processedHtml = await client.getEvent(testRoom, htmlMessage);
        assert.equal(Object.keys(processedHtml.content).length, 0, "This html image event should have been redacted");

        let processedVideo = await client.getEvent(testRoom, videoMessage);
        assert.equal(Object.keys(processedVideo.content).length, 0, "This  event should have been redacted");
    });

    it("Doesn't redact massages that are not media.", async function () {
        this.timeout(20000);

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${testRoom}`,
        });
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable MessageIsMediaProtection`,
            });
        });

        let content = { msgtype: "m.text", body: "don't redact me bro" };
        let textMessage = await client.sendMessage(testRoom, content);

        await delay(500);
        let processedImage = await client.getEvent(testRoom, textMessage);
        assert.equal(Object.keys(processedImage.content).length, 2, "This event should not have been redacted.");
    });
});
