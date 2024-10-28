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

import { strict as assert } from "assert";
import { newTestUser } from "../clientHelper";
import { getFirstReaction } from "./commandUtils";

describe("Test: power levels", function () {
    it("Does not allow the bot to demote itself or members of management room in a protected room.", async function () {
        this.timeout(60000);
        const mod = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        const mod2 = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator2" } });
        await mod.joinRoom(this.config.managementRoom);
        await mod2.joinRoom(this.config.managementRoom);

        const targetRoom = await mod.createRoom({ preset: "public_chat" });
        await this.mjolnir.client.joinRoom(targetRoom);
        await mod2.joinRoom(targetRoom);
        const botId = await this.mjolnir.client.getUserId();
        await mod.setUserPowerLevel(botId, targetRoom, 100);
        const mod2Id = await mod2.getUserId();
        await mod.setUserPowerLevel(mod2Id, targetRoom, 100);

        await mod.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text.",
            body: `!mjolnir rooms add ${targetRoom}`,
        });

        await mod.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir powerlevel ${botId} 50 ${targetRoom}`,
        });

        mod.start();
        let reply = new Promise((resolve, reject) => {
            mod.on("room.message", (roomId: string, event: any) => {
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event.content?.body.includes("You are attempting to lower the bot/a moderator's power level")
                ) {
                    resolve(event);
                }
            });
        });
        await reply;

        let currentLevels = await mod.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        const botLevel = currentLevels["users"][botId];
        assert.equal(botLevel, 100);

        await mod.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir powerlevel ${mod2Id} 50 ${targetRoom}`,
        });

        let reply2 = new Promise((resolve, reject) => {
            mod.on("room.message", (roomId: string, event: any) => {
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event.content?.body.includes("You are attempting to lower the bot/a moderator's power level")
                ) {
                    resolve(event);
                }
            });
        });
        await reply2;

        currentLevels = await mod.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        const mod2Level = currentLevels["users"][mod2Id];
        assert.equal(mod2Level, 100);

        mod.stop();
    });

    it("Does allow the bot to demote itself or members of management room in a protected room with a --force argument.", async function () {
        this.timeout(60000);
        const mod = await newTestUser(this.config.homeserverUrl, { name: { contains: "force-moderator" } });
        const mod2 = await newTestUser(this.config.homeserverUrl, { name: { contains: "force-moderator2" } });
        await mod.joinRoom(this.config.managementRoom);
        await mod2.joinRoom(this.config.managementRoom);

        const targetRoom = await mod.createRoom({ preset: "public_chat" });
        await this.mjolnir.client.joinRoom(targetRoom);
        await mod2.joinRoom(targetRoom);
        const botId = await this.mjolnir.client.getUserId();
        await mod.setUserPowerLevel(botId, targetRoom, 100);
        const mod2Id = await mod2.getUserId();
        await mod.setUserPowerLevel(mod2Id, targetRoom, 75);

        await mod.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text.",
            body: `!mjolnir rooms add ${targetRoom}`,
        });

        mod.start();
        await getFirstReaction(mod, this.mjolnir.managementRoomId, "✅", async () => {
            return await mod.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir powerlevel ${mod2Id} 50 ${targetRoom} --force`,
            });
        });
        let currentLevels = await mod.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        const mod2Level = currentLevels["users"][mod2Id];
        assert.equal(mod2Level, 50);

        await getFirstReaction(mod, this.mjolnir.managementRoomId, "✅", async () => {
            return await mod.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir powerlevel ${botId} 50 ${targetRoom} --force`,
            });
        });
        currentLevels = await mod.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        const botLevel = currentLevels["users"][botId];
        assert.equal(botLevel, 50);

        mod.stop();
    });
});
