import { strict as assert } from "assert";

import { newTestUser } from "../clientHelper";
import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";
import { randomUUID } from "crypto";

describe("Test: The quarantineMedia command", function () {
    let badUser: MatrixClient, moderator: MatrixClient;
    let mjolnirUserId: string, badUserId: string, targetRoom: string;
    let mjolnir: MatrixClient;

    this.beforeEach(async function () {
        // verify mjolnir is admin
        const admin = await this.mjolnir.isSynapseAdmin();
        if (!admin) {
            throw new Error(`Mjolnir needs to be admin for this test.`);
        }
        badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer" } });
        moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        mjolnir = this.config.RUNTIME.client!;
        await moderator.start();
        mjolnirUserId = await mjolnir.getUserId();
        badUserId = await badUser.getUserId();

        await moderator.joinRoom(this.config.managementRoom);
        targetRoom = await moderator.createRoom({
            invite: [await badUser.getUserId(), mjolnirUserId],
            power_level_content_override: {
                users: {
                    [mjolnirUserId]: 100,
                    [await moderator.getUserId()]: 100,
                },
            },
        });

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir rooms add ${targetRoom}`,
            });
        });
        await badUser.joinRoom(targetRoom);
    });
    // If a test has a timeout while awaitng on a promise then we never get given control back.
    afterEach(function () {
        this.moderator?.stop();
    });

    it("Correctly quarantines media by user", async function () {
        this.timeout(30000);
        const someFakeMedia = await Promise.all([
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
        ]);

        for (const mxc of someFakeMedia) {
            await badUser.sendMessage(targetRoom, {
                msgtype: "m.text",
                body: mxc,
            });
        }

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir quarantine-media ${badUserId}`,
            });
        });

        const { media } = await mjolnir.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(badUserId)}/media`,
        );
        assert.equal(media.length, 3);
    });

    it("Correctly quarantines media by server", async function () {
        this.timeout(30000);
        const badUser2 = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-2" } });
        const badUserId2 = await badUser2.getUserId();
        await moderator.inviteUser(badUserId2, targetRoom);
        await badUser2.joinRoom(targetRoom);

        const someFakeMediaA = await Promise.all([
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
        ]);
        const someFakeMediaB = await Promise.all([
            badUser2.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser2.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser2.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
        ]);

        for (const mxc of someFakeMediaA) {
            await badUser.sendMessage(targetRoom, {
                msgtype: "m.text",
                body: mxc,
            });
        }
        for (const mxc of someFakeMediaB) {
            await badUser2.sendMessage(targetRoom, {
                msgtype: "m.text",
                body: mxc,
            });
        }
        const serverPart = badUserId.split(":")[1];

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir quarantine-media ${serverPart}`,
            });
        });

        const { media: mediaA } = await mjolnir.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(badUserId)}/media`,
        );
        assert.equal(mediaA.length, 3);
        const { media: mediaB } = await mjolnir.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(badUserId2)}/media`,
        );
        assert.equal(mediaB.length, 3);
    });

    it("Correctly quarantines media by roomId", async function () {
        this.timeout(30000);
        const someFakeMedia = await Promise.all([
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
            badUser.uploadContent(Buffer.from(randomUUID(), "utf-8"), "text/plain"),
        ]);
        for (const mxc of someFakeMedia) {
            await badUser.sendMessage(targetRoom, {
                msgtype: "m.text",
                body: mxc,
            });
        }

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir quarantine-media ${targetRoom}`,
            });
        });

        const { media: mediaA } = await mjolnir.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(badUserId)}/media`,
        );
        assert.equal(mediaA.length, 3);
    });
});
