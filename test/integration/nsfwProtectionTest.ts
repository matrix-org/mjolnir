import { newTestUser } from "./clientHelper";

import { MatrixClient, MXCUrl } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commands/commandUtils";
import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { ProtectionManager } from "../../src/protections/ProtectionManager";

describe("Test: NSFW protection", function () {
    let client: MatrixClient;
    let room: string;
    this.beforeEach(async function () {
        // verify mjolnir is admin
        const admin = await this.mjolnir.isSynapseAdmin();
        if (!admin) {
            throw new Error(`Mjolnir needs to be admin for this test.`);
        }
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "nsfw-protection" } });
        await client.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        room = await client.createRoom({ invite: [mjolnirId] });
        await client.joinRoom(room);
        await client.joinRoom(this.config.managementRoom);
        await client.setUserPowerLevel(mjolnirId, room, 100);
    });
    this.afterEach(async function () {
        await client.stop();
    });

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Nsfw protection doesn't redact sfw images", async function () {
        this.timeout(20000);

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await client.uploadContent(data, "image/png");
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await client.sendMessage(room, content);

        await delay(500);
        let processedImage = await client.getEvent(room, imageMessage);
        assert.equal(Object.keys(processedImage.content).length, 3, "This event should not have been redacted");
    });

    it("Nsfw protection redacts nsfw images", async function () {
        this.timeout(20000);
        // dial the sensitivity on the protection way up so that all images are flagged as NSFW
        this.mjolnir.config.nsfwSensitivity = 0.0;

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await client.uploadContent(data, "image/png");
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await client.sendMessage(room, content);

        let formatted_body = `<img src=${mxc} />`;
        let htmlContent = {
            msgtype: "m.image",
            body: formatted_body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        let htmlMessage = await client.sendMessage(room, htmlContent);

        await delay(500);
        let processedImage = await client.getEvent(room, imageMessage);
        assert.equal(Object.keys(processedImage.content).length, 0, "This event should have been redacted");

        let processedHtml = await client.getEvent(room, htmlMessage);
        assert.equal(Object.keys(processedHtml.content).length, 0, "This html image event should have been redacted");
    });

    it("Nsfw protection redacts and quarantines nsfw images", async function () {
        this.timeout(20000);
        // dial the sensitivity on the protection way up so that all images are flagged as NSFW
        this.mjolnir.config.nsfwSensitivity = 0.0;

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });
        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir config set NsfwProtection.quarantine true`,
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await client.uploadContent(data, "image/png");
        const mediaId = MXCUrl.parse(mxc).mediaId;
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await client.sendMessage(room, content);

        let formatted_body = `<img src=${mxc} />`;
        let htmlContent = {
            msgtype: "m.image",
            body: formatted_body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        let htmlMessage = await client.sendMessage(room, htmlContent);

        await delay(500);
        let processedImage = await client.getEvent(room, imageMessage);
        assert.equal(Object.keys(processedImage.content).length, 0, "This event should have been redacted");

        let processedHtml = await client.getEvent(room, htmlMessage);
        assert.equal(Object.keys(processedHtml.content).length, 0, "This html image event should have been redacted");

        const mjolnirClient = this.config.RUNTIME.client!;
        const { media } = await mjolnirClient.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(await client.getUserId())}/media`,
        );

        assert.equal(media[0].media_id, mediaId);
        const mjolnirUserId = await mjolnirClient.getUserId();
        assert.equal(media[0].quarantined_by, mjolnirUserId);
    });

    it("Nsfw protection does not react messages without any MXCs", async function () {
        this.timeout(20000);

        const protectionManager = this.mjolnir.protectionManager as ProtectionManager;

        // Hack our way into the protection manager to determine if it has processed an event.
        let sentEventId: string;
        const handledEventPromise = new Promise<void>((resolve) => {
            const handleEvent = protectionManager["handleEvent"].bind(protectionManager);
            protectionManager["handleEvent"] = async (roomId, event) => {
                try {
                    return handleEvent(roomId, event);
                } finally {
                    if (sentEventId === event.event_id) {
                        resolve();
                    }
                }
            };
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });

        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        let content = { body: "This is just some text", msgtype: "m.text" };
        sentEventId = await client.sendMessage(room, content);
        await handledEventPromise;
        let processedEvent = await client.getEvent(room, sentEventId);
        assert.equal(Object.keys(processedEvent.content).length, 2, "This event should not have been redacted");
    });
});
