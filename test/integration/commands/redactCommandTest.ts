import { strict as assert } from "assert";

import { newTestUser } from "../clientHelper";
import { getMessagesByUserIn, filterRooms } from "../../../src/utils";
import { LogService, MatrixClient, MXCUrl } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";
import { SynapseAdminApis } from "@vector-im/matrix-bot-sdk";

describe("Test: The redaction command - if admin", function () {
    this.beforeEach(async function () {
        // verify mjolnir is admin
        const admin = await this.mjolnir.isSynapseAdmin();
        if (!admin) {
            throw new Error(`Mjolnir needs to be admin for this test.`);
        }
    });
    // If a test has a timeout while awaitng on a promise then we never get given control back.
    afterEach(function () {
        this.moderator?.stop();
    });

    it("Mjölnir redacts all of the events sent by a spammer when instructed to by giving their id and a room id.", async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-needs-redacting" } });
        let badUserId = await badUser.getUserId();
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();
        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
        await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
        await badUser.joinRoom(targetRoom);
        moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text.",
            body: `!mjolnir rooms add ${targetRoom}`,
        });

        LogService.debug("redactionTest", `targetRoom: ${targetRoom}, managementRoom: ${this.config.managementRoom}`);
        // Sandwich irrelevant messages in bad messages.
        await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
        await Promise.all(
            [...Array(50).keys()].map((i) =>
                moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${i}` }),
            ),
        );
        for (let i = 0; i < 5; i++) {
            await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
        }
        await Promise.all(
            [...Array(50).keys()].map((i) =>
                moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${i}` }),
            ),
        );
        await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact ${badUserId} ${targetRoom}`,
                });
            });
        } finally {
            moderator.stop();
        }

        function delay(ms: number) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }
        await delay(1000);
        await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, function (events) {
            events.map((e) => {
                if (e.type === "m.room.member") {
                    assert.equal(
                        Object.keys(e.content).length,
                        1,
                        "Only membership should be left on the membership even when it has been redacted.",
                    );
                } else if (Object.keys(e.content).length !== 0 && e.type != "m.room.redaction") {
                    throw new Error(`This event should have been redacted: ${JSON.stringify(e, null, 2)}`);
                }
            });
        });
    });

    it("Mjölnir redacts all of the events sent by a spammer when instructed to by giving their id in multiple rooms.", async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-needs-redacting" } });
        let badUserId = await badUser.getUserId();
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();
        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.config.managementRoom);
        let targetRooms: string[] = [];
        for (let i = 0; i < 5; i++) {
            let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
            await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
            await badUser.joinRoom(targetRoom);
            await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text.",
                body: `!mjolnir rooms add ${targetRoom}`,
            });
            targetRooms.push(targetRoom);

            // Sandwich irrelevant messages in bad messages.
            await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
            await Promise.all(
                [...Array(50).keys()].map((j) =>
                    moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${j}` }),
                ),
            );
            for (let j = 0; j < 5; j++) {
                await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
            }
            await Promise.all(
                [...Array(50).keys()].map((j) =>
                    moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${j}` }),
                ),
            );
            await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
        }

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact ${badUserId}`,
                });
            });
        } finally {
            moderator.stop();
        }

        targetRooms.map(async (targetRoom) => {
            await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, function (events) {
                events.map((e) => {
                    if (e.type === "m.room.member") {
                        assert.equal(
                            Object.keys(e.content).length,
                            1,
                            "Only membership should be left on the membership even when it has been redacted.",
                        );
                    } else if (Object.keys(e.content).length !== 0) {
                        throw new Error(`This event should have been redacted: ${JSON.stringify(e, null, 2)}`);
                    }
                });
            });
        });
    });
    it("Redacts a single event when instructed to.", async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-needs-redacting" } });
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();
        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
        await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
        await badUser.joinRoom(targetRoom);
        moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text.",
            body: `!mjolnir rooms add ${targetRoom}`,
        });
        let eventToRedact = await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact https://matrix.to/#/${encodeURIComponent(targetRoom)}/${encodeURIComponent(eventToRedact)}`,
                });
            });
        } finally {
            moderator.stop();
        }

        let redactedEvent = await moderator.getEvent(targetRoom, eventToRedact);
        assert.equal(Object.keys(redactedEvent.content).length, 0, "This event should have been redacted");
    });

    it("Correctly quarantines media after being redacted", async function () {
        this.timeout(30000);
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer" } });
        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        const mjolnir: MatrixClient = this.config.RUNTIME.client!;
        await moderator.start();
        let mjolnirUserId = await mjolnir.getUserId();
        const badUserId = await badUser.getUserId();
        const someFakeMedia = await badUser.uploadContent(Buffer.from("bibble bobble", "utf-8"), "text/plain");
        const { mediaId } = MXCUrl.parse(someFakeMedia);

        await moderator.joinRoom(this.config.managementRoom);
        let targetRoom = await moderator.createRoom({
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
        await badUser.sendMessage(targetRoom, {
            msgtype: "m.text",
            body: someFakeMedia,
        });

        try {
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact ${badUserId} --quarantine`,
                });
            });
        } finally {
            moderator.stop();
        }

        const { media } = await mjolnir.doRequest(
            "GET",
            `/_synapse/admin/v1/users/${encodeURIComponent(badUserId)}/media`,
        );
        assert.equal(media[0].media_id, mediaId);
        assert.equal(media[0].quarantined_by, mjolnirUserId);
    });
});

describe("Test: The redaction command - if not admin", function () {
    // If a test has a timeout while awaiting on a promise then we never get given control back.
    afterEach(function () {
        this.moderator?.stop();
    });

    it("Mjölnir redacts all of the events sent by a spammer when instructed to by giving their id and a room id.", async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-needs-redacting" } });
        let badUserId = await badUser.getUserId();
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();

        // demote mjolnir from admin
        let newAdmin = await newTestUser(this.config.homeserverUrl, { name: { contains: "new-admin" } });
        const adminUserId = await newAdmin.getUserId();
        const mjolnirAdmin = new SynapseAdminApis(this.mjolnir.client);
        await mjolnirAdmin.upsertUser(adminUserId, { admin: true });
        const newAdminClient = new SynapseAdminApis(newAdmin);
        await newAdminClient.upsertUser(mjolnirUserId, { admin: false });
        const admin = await this.mjolnir.isSynapseAdmin();
        if (admin) {
            throw new Error(`Mjolnir needs to not be admin for this test.`);
        }

        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
        await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
        await badUser.joinRoom(targetRoom);
        moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text.",
            body: `!mjolnir rooms add ${targetRoom}`,
        });

        LogService.debug("redactionTest", `targetRoom: ${targetRoom}, managementRoom: ${this.config.managementRoom}`);
        // Sandwich irrelevant messages in bad messages.
        await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
        await Promise.all(
            [...Array(50).keys()].map((i) =>
                moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${i}` }),
            ),
        );
        for (let i = 0; i < 5; i++) {
            await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
        }
        await Promise.all(
            [...Array(50).keys()].map((i) =>
                moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${i}` }),
            ),
        );
        await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact ${badUserId} ${targetRoom}`,
                });
            });
        } finally {
            moderator.stop();
        }

        await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, function (events) {
            events.map((e) => {
                if (e.type === "m.room.member") {
                    assert.equal(
                        Object.keys(e.content).length,
                        1,
                        "Only membership should be left on the membership even when it has been redacted.",
                    );
                } else if (Object.keys(e.content).length !== 0) {
                    throw new Error(`This event should have been redacted: ${JSON.stringify(e, null, 2)}`);
                }
            });
        });

        // reinstall mjolnir as admin before reference to new admin account goes away
        await newAdminClient.upsertUser(mjolnirUserId, { admin: true });
        const returnedAdmin = await this.mjolnir.isSynapseAdmin();
        if (!returnedAdmin) {
            throw new Error(`Error restoring mjolnir to admin.`);
        }
    });

    it("Mjölnir redacts all of the events sent by a spammer when instructed to by giving their id in multiple rooms.", async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-needs-redacting" } });
        let badUserId = await badUser.getUserId();
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();

        // demote mjolnir from admin
        let newAdmin = await newTestUser(this.config.homeserverUrl, { name: { contains: "new-admin" } });
        const adminUserId = await newAdmin.getUserId();
        const mjolnirAdmin = new SynapseAdminApis(this.mjolnir.client);
        await mjolnirAdmin.upsertUser(adminUserId, { admin: true });
        const newAdminClient = new SynapseAdminApis(newAdmin);
        await newAdminClient.upsertUser(mjolnirUserId, { admin: false });
        const admin = await this.mjolnir.isSynapseAdmin();
        if (admin) {
            throw new Error(`Mjolnir needs to not be admin for this test.`);
        }

        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.config.managementRoom);
        let targetRooms: string[] = [];
        for (let i = 0; i < 5; i++) {
            let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
            await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
            await badUser.joinRoom(targetRoom);
            await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text.",
                body: `!mjolnir rooms add ${targetRoom}`,
            });
            targetRooms.push(targetRoom);

            // Sandwich irrelevant messages in bad messages.
            await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
            await Promise.all(
                [...Array(50).keys()].map((j) =>
                    moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${j}` }),
                ),
            );
            for (let j = 0; j < 5; j++) {
                await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
            }
            await Promise.all(
                [...Array(50).keys()].map((j) =>
                    moderator.sendMessage(targetRoom, { msgtype: "m.text.", body: `Irrelevant Message #${j}` }),
                ),
            );
            await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });
        }

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact ${badUserId}`,
                });
            });
        } finally {
            moderator.stop();
        }

        targetRooms.map(async (targetRoom) => {
            await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, function (events) {
                events.map((e) => {
                    if (e.type === "m.room.member") {
                        assert.equal(
                            Object.keys(e.content).length,
                            1,
                            "Only membership should be left on the membership even when it has been redacted.",
                        );
                    } else if (Object.keys(e.content).length !== 0) {
                        throw new Error(`This event should have been redacted: ${JSON.stringify(e, null, 2)}`);
                    }
                });
            });
        });
        // reinstall mjolnir as admin before reference to new admin account goes away
        await newAdminClient.upsertUser(mjolnirUserId, { admin: true });
        const returnedAdmin = await this.mjolnir.isSynapseAdmin();
        if (!returnedAdmin) {
            throw new Error(`Error restoring mjolnir to admin.`);
        }
    });

    it("Redacts a single event when instructed to.", async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer-needs-redacting" } });
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();

        // demote mjolnir from admin
        let newAdmin = await newTestUser(this.config.homeserverUrl, { name: { contains: "new-admin" } });
        const adminUserId = await newAdmin.getUserId();
        const mjolnirAdmin = new SynapseAdminApis(this.mjolnir.client);
        await mjolnirAdmin.upsertUser(adminUserId, { admin: true });
        const newAdminClient = new SynapseAdminApis(newAdmin);
        await newAdminClient.upsertUser(mjolnirUserId, { admin: false });
        const admin = await this.mjolnir.isSynapseAdmin();
        if (admin) {
            throw new Error(`Mjolnir needs to not be admin for this test.`);
        }

        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
        await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
        await badUser.joinRoom(targetRoom);
        moderator.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text.",
            body: `!mjolnir rooms add ${targetRoom}`,
        });
        let eventToRedact = await badUser.sendMessage(targetRoom, { msgtype: "m.text", body: "Very Bad Stuff" });

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `!mjolnir redact https://matrix.to/#/${encodeURIComponent(targetRoom)}/${encodeURIComponent(eventToRedact)}`,
                });
            });
        } finally {
            moderator.stop();
        }

        let redactedEvent = await moderator.getEvent(targetRoom, eventToRedact);
        assert.equal(Object.keys(redactedEvent.content).length, 0, "This event should have been redacted");

        // reinstall mjolnir as admin before reference to new admin account goes away
        await newAdminClient.upsertUser(mjolnirUserId, { admin: true });
        const returnedAdmin = await this.mjolnir.isSynapseAdmin();
        if (!returnedAdmin) {
            throw new Error(`Error restoring mjolnir to admin.`);
        }
    });

    it("Correctly tracks room membership of redactee", async function () {
        this.timeout(60000);
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer" } });
        let moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        this.moderator = moderator;
        const mjolnir = this.config.RUNTIME.client!;
        let mjolnirUserId = await mjolnir.getUserId();
        const badUserId = await badUser.getUserId();

        await moderator.joinRoom(this.config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId] });
        await badUser.joinRoom(targetRoom);
        await badUser.createRoom(); // create a room that Mjolnir won't have any interest in

        // send a message, leave, then get banned
        badUser.sendMessage(targetRoom, {
            msgtype: "m.text.",
            body: `a bad message`,
        });
        badUser.leaveRoom(targetRoom);
        await moderator.banUser(badUserId, targetRoom, "spam");

        // check that filterRooms tracks that badUser was in target room, and doesn't pick up other room badUser
        // is in
        const rooms = await filterRooms([targetRoom], badUserId, false, moderator);
        assert.equal(rooms.length, 1);
        assert.equal(rooms[0], targetRoom);
    });
});
