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

import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { newTestUser } from "./clientHelper";
import { strict as assert } from "assert";
import { getFirstReaction } from "./commands/commandUtils";

describe("Test: Bot doesn't ban moderation room members or ignored entities.", function () {
    let client: MatrixClient;
    let room: string;
    let badClient: MatrixClient;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "mod-room-test" } });
        await client.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        badClient = await newTestUser(this.config.homeserverUrl, { name: { contains: "mod-room-test-to-be-banned" } });
        const badId = await badClient.getUserId();
        room = await client.createRoom({ invite: [mjolnirId, badId] });
        await badClient.joinRoom(room);
        await client.joinRoom(this.config.managementRoom);
        await client.setUserPowerLevel(mjolnirId, room, 100);
    });
    this.afterEach(async function () {
        await client.stop();
    });

    it("Properly tracks newly joined members in the moderation room", async function () {
        this.timeout(20000);

        function delay(ms: number) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        await delay(4000);
        const currentMods = this.mjolnir.moderators.listAll();
        let expectedCurrentMods = [await client.getUserId(), await this.mjolnir.client.getUserId()];
        expectedCurrentMods.forEach((mod) => {
            if (!currentMods.includes(mod)) {
                assert.fail("Expected mod not found.");
            }
        });
        const newMod = await newTestUser(this.config.homeserverUrl, { name: { contains: "mod-room-test" } });
        await newMod.joinRoom(this.config.managementRoom);
        await delay(1000);
        let updatedMods = this.mjolnir.moderators.listAll();
        if (!updatedMods.includes(await newMod.getUserId())) {
            assert.fail("New moderator not found.");
        }
    });

    it("Ignore command adds entities to ignore list.", async function () {
        this.timeout(20000);

        function delay(ms: number) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        const helpfulBot = await newTestUser(this.config.homeserverUrl, { name: { contains: "mod-room-test-bot" } });
        const botId = await helpfulBot.getUserId();

        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir ignore ${botId}`,
            });
        });
        await delay(1000);
        const mods = this.mjolnir.moderators.listAll();
        if (!mods.includes(botId)) {
            assert.fail("Bot not added to moderator list.");
        }
    });

    it("Moderators and ignored entities are not banned by automatic procedures.", async function () {
        this.timeout(20000);
        function delay(ms: number) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${room}`,
        });
        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir enable BasicFloodingProtection`,
            });
        });

        for (let i = 0; i < 12; i++) {
            await badClient.sendMessage(room, { msgtype: "m.text", body: "ban me" });
        }

        await delay(3000);
        const badId = await badClient.getUserId();
        const badMemberEvent = await this.mjolnir.client.getRoomStateEvent(room, "m.room.member", badId);
        if (badMemberEvent["membership"] !== "ban") {
            assert.fail("Basic flooding protection is not working, this user should have been banned.");
        }

        for (let i = 0; i < 12; i++) {
            await this.mjolnir.client.sendMessage(room, { msgtype: "m.text", body: "doing mod things" });
        }
        const mjolnirId = await this.mjolnir.client.getUserId();
        const mjolnirMemberEvent = await this.mjolnir.client.getRoomStateEvent(room, "m.room.member", mjolnirId);

        if (mjolnirMemberEvent["membership"] === "ban") {
            assert.fail("Bot has banned itself.");
        }

        const helpfulBot = await newTestUser(this.config.homeserverUrl, { name: { contains: "mod-room-test-bot" } });
        const botId = await helpfulBot.getUserId();

        await this.mjolnir.client.inviteUser(botId, room);
        await helpfulBot.joinRoom(room);

        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir ignore ${botId}`,
            });
        });

        for (let i = 0; i < 12; i++) {
            await helpfulBot.sendMessage(room, { msgtype: "m.text", body: "doing helpful bot things" });
        }
        const botMemberEvent = await this.mjolnir.client.getRoomStateEvent(room, "m.room.member", botId);

        if (botMemberEvent["membership"] === "ban") {
            assert.fail("Bot has banned a member of ignore list.");
        }
    });
});
