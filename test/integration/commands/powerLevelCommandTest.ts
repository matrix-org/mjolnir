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

describe("Test: power levels", function () {
    it("Does not allow the bot to demote itself in a protected room.", async function () {
        this.timeout(60000);
        const mod = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        await mod.joinRoom(this.config.managementRoom);
        const targetRoom = await mod.createRoom({ preset: "public_chat" });
        await this.mjolnir.client.joinRoom(targetRoom);
        const botId = await this.mjolnir.client.getUserId();
        await mod.setUserPowerLevel(botId, targetRoom, 100);

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
                    event.content?.body.includes("You are attempting to lower the bot's power level")
                ) {
                    resolve(event);
                }
            });
        });
        await reply;

        const currentLevels = await mod.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        const botLevel = currentLevels["users"][botId];
        assert.equal(botLevel, 100);

        mod.stop();
    });
});
