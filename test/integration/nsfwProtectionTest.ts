import { newTestUser } from "./clientHelper";

import { MatrixClient, MXCUrl } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commands/commandUtils";
import { equal } from "node:assert/strict";
import { readFileSync } from "fs";
import { ProtectionManager } from "../../src/protections/ProtectionManager";

describe("Test: NSFW protection", function () {
    let modClient: MatrixClient;
    let spammer: MatrixClient;
    let room: string;
    this.beforeEach(async function () {
        // verify mjolnir is admin
        const admin = await this.mjolnir.isSynapseAdmin();
        if (!admin) {
            throw new Error(`Mjolnir needs to be admin for this test.`);
        }
        modClient = await newTestUser(this.config.homeserverUrl, { name: { contains: "nsfw-protection-moderator" } });
        spammer = await newTestUser(this.config.homeserverUrl, { name: { contains: "nsfw-protection-spammer" } });
        await modClient.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        const spammerId = await spammer.getUserId();
        room = await modClient.createRoom({ invite: [mjolnirId, spammerId] });
        await spammer.joinRoom(room);
        await modClient.joinRoom(room);
        await modClient.joinRoom(this.config.managementRoom);
        await modClient.setUserPowerLevel(mjolnirId, room, 100);
    });
    this.afterEach(async function () {
        await modClient.stop();
    });

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("Nsfw protection doesn't redact sfw images", async function () {
        this.timeout(20000);

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await spammer.uploadContent(data, "image/png");
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await spammer.sendMessage(room, content);

        await delay(500);
        let processedImage = await spammer.getEvent(room, imageMessage);
        equal(Object.keys(processedImage.content).length, 3, "This event should not have been redacted");
    });

    it("Nsfw protection redacts nsfw images", async function () {
        this.timeout(20000);
        // dial the sensitivity on the protection way up so that all images are flagged as NSFW
        this.mjolnir.config.nsfwSensitivity = 0.0;

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await spammer.uploadContent(data, "image/png");
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await spammer.sendMessage(room, content);

        let formatted_body = `<img src=${mxc} />`;
        let htmlContent = {
            msgtype: "m.image",
            body: formatted_body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        let htmlMessage = await spammer.sendMessage(room, htmlContent);

        await delay(500);
        let processedImage = await modClient.getEvent(room, imageMessage);
        equal(Object.keys(processedImage.content).length, 0, "This event should have been redacted");

        let processedHtml = await modClient.getEvent(room, htmlMessage);
        equal(Object.keys(processedHtml.content).length, 0, "This html image event should have been redacted");
    });

    it("Nsfw protection redacts nsfw images", async function () {
        this.timeout(20000);
        // dial the sensitivity on the protection way up so that all images are flagged as NSFW
        this.mjolnir.config.nsfwSensitivity = 0.0;

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await spammer.uploadContent(data, "image/png");
        const mediaId = MXCUrl.parse(mxc).mediaId;
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await spammer.sendMessage(room, content);

        let formatted_body = `<img src=${mxc} />`;
        let htmlContent = {
            msgtype: "m.image",
            body: formatted_body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        let htmlMessage = await spammer.sendMessage(room, htmlContent);

        await delay(500);
        let processedImage = await modClient.getEvent(room, imageMessage);
        equal(Object.keys(processedImage.content).length, 0, "This event should have been redacted");

        let processedHtml = await modClient.getEvent(room, htmlMessage);
        equal(Object.keys(processedHtml.content).length, 0, "This html image event should have been redacted");
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

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });

        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        let content = { body: "This is just some text", msgtype: "m.text" };
        sentEventId = await spammer.sendMessage(room, content);
        await handledEventPromise;
        let processedEvent = await modClient.getEvent(room, sentEventId);
        equal(Object.keys(processedEvent.content).length, 2, "This event should not have been redacted");
    });
    it("Nsfw protection does not redact images from moderators", async function () {
        this.timeout(20000);
        // dial the sensitivity on the protection way up so that all images are flagged as NSFW
        this.mjolnir.config.nsfwSensitivity = 0.0;

        await modClient.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(modClient, this.mjolnir.managementRoomId, "✅", async () => {
            return await modClient.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable NsfwProtection`,
            });
        });

        const data = readFileSync("test_tree.jpg");
        const mxc = await modClient.uploadContent(data, "image/png");
        let content = { msgtype: "m.image", body: "test.jpeg", url: mxc };
        let imageMessage = await modClient.sendMessage(room, content);

        let formatted_body = `<img src=${mxc} />`;
        let htmlContent = {
            msgtype: "m.image",
            body: formatted_body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        let htmlMessage = await modClient.sendMessage(room, htmlContent);

        await delay(500);
        let processedImage = await modClient.getEvent(room, imageMessage);
        equal(Object.keys(processedImage.content).length, 3, "This event should not have been redacted");

        let processedHtml = await modClient.getEvent(room, htmlMessage);
        equal(Object.keys(processedHtml.content).length, 4, "This html image event should not have been redacted");
    });
});
