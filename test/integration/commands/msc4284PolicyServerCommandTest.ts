import { strict as assert } from "assert";

import { newTestUser } from "../clientHelper";
import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";
import { randomUUID } from "crypto";

describe("Test: The msc4284_set command", function () {
    let moderator: MatrixClient;
    let mjolnirUserId: string, protectedRoomId: string, unprotectedRoomId: string, unprotectedRoomAlias: string;
    let mjolnir: MatrixClient;

    this.beforeEach(async function () {
        moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        mjolnir = this.config.RUNTIME.client!;
        await moderator.start();
        mjolnirUserId = await mjolnir.getUserId();

        await moderator.joinRoom(this.config.managementRoom);
        protectedRoomId = await moderator.createRoom({
            invite: [mjolnirUserId],
            power_level_content_override: {
                users: {
                    [mjolnirUserId]: 100,
                    [await moderator.getUserId()]: 100,
                },
            },
        });
        unprotectedRoomAlias = `unprotected-${randomUUID().slice(0, 8)}`;
        unprotectedRoomId = await moderator.createRoom({
            invite: [mjolnirUserId],
            room_alias_name: unprotectedRoomAlias,
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
                body: `!mjolnir rooms add ${protectedRoomId}`,
            });
        });
        await mjolnir.joinRoom(unprotectedRoomId);
    });
    // If a test has a timeout while awaitng on a promise then we never get given control back.
    this.afterEach(async function () {
        await moderator.stop();
    });

    it("Correctly sets and unsets by unprotected room alias", async function () {
        this.timeout(30000);

        // Set first

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir msc4284_set ${unprotectedRoomAlias} 1.example.org`,
            });
        });

        const { via: via1 } = await mjolnir.getRoomStateEvent(unprotectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via1, "1.example.org");

        // Unset second
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir msc4284_set ${unprotectedRoomAlias} unset`,
            });
        });

        let { via: via2 } = await mjolnir.getRoomStateEvent(unprotectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via2, undefined);
    });

    it("Correctly sets and unsets by unprotected room ID", async function () {
        this.timeout(30000);

        // Set first

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir msc4284_set ${unprotectedRoomId} 2.example.org`,
            });
        });

        const { via: via1 } = await mjolnir.getRoomStateEvent(unprotectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via1, "2.example.org");

        // Unset second
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir msc4284_set ${unprotectedRoomId} unset`,
            });
        });

        let { via: via2 } = await mjolnir.getRoomStateEvent(unprotectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via2, undefined);
    });

    it("Correctly sets and unsets to all protected rooms", async function () {
        this.timeout(30000);

        // Set first

        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir msc4284_set * 3.example.org`,
            });
        });

        const { via: via1 } = await mjolnir.getRoomStateEvent(unprotectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via1, undefined); // verify we didn't touch the room
        const { via: via2 } = await mjolnir.getRoomStateEvent(protectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via2, "3.example.org");

        // Unset second
        await getFirstReaction(moderator, this.mjolnir.managementRoomId, "✅", async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir msc4284_set * unset`,
            });
        });

        const { via: via3 } = await mjolnir.getRoomStateEvent(unprotectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via3, undefined); // shouldn't have changed
        const { via: via4 } = await mjolnir.getRoomStateEvent(protectedRoomId, "org.matrix.msc4284.policy", "");
        assert.equal(via4, undefined);
    });
});
