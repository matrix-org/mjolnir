﻿import { strict as assert } from "assert";

import { newTestUser } from "../clientHelper";
import { PowerLevelAction } from "matrix-bot-sdk/lib/models/PowerLevelAction";
import { LogService } from "@vector-im/matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";

describe("Test: The make admin command", function () {
    afterEach(function () {
        this.moderator?.stop();
        this.userA?.stop();
        this.userB?.stop();
        this.userC?.stop();
    });

    it('Mjölnir make the bot self room administrator', async function () {
        this.timeout(90000);
        if (!this.config.admin?.enableMakeRoomAdminCommand) {
            done();
        }
        const mjolnir = this.config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        const userA = await newTestUser(this.config.homeserverUrl, { name: { contains: "a" } });
        const userAId = await userA.getUserId();
        this.moderator = moderator;
        this.userA = userA;
        let powerLevels: any;

        await moderator.joinRoom(this.config.managementRoom);
        LogService.debug("makeadminTest", `Joining managementRoom: ${this.config.managementRoom}`);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId], preset: "public_chat" });
        LogService.debug("makeadminTest", `moderator creating targetRoom: ${targetRoom}; and inviting ${mjolnirUserId}`);
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text.', body: `!mjolnir rooms add ${targetRoom}` });
        LogService.debug("makeadminTest", `Adding targetRoom: ${targetRoom}`);
        // allow bot time to join room
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
            await moderator.start();
            await userA.start();
            await userA.joinRoom(targetRoom);
            powerLevels = await mjolnir.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
            assert.notEqual(powerLevels["users"][mjolnirUserId], 100, `Bot should not yet be an admin of ${targetRoom}`);
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                LogService.debug("makeadminTest", `Sending: !mjolnir make admin ${targetRoom}`);
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir make admin ${targetRoom}` });
            });
        } finally {
            await moderator.stop();
            await userA.stop();
        }
        LogService.debug("makeadminTest", `Making self admin`);

        powerLevels = await mjolnir.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        assert.equal(powerLevels["users"][mjolnirUserId], 100, "Bot should be a room admin.");
        assert.equal(powerLevels["users"][userAId], (0 || undefined), "User A is not supposed to be a room admin.");
    });

    it('Mjölnir make the tester room administrator', async function () {
        this.timeout(90000);
        if (!this.config.admin?.enableMakeRoomAdminCommand) {
            done();
        }
        const mjolnir = this.config.RUNTIME.client!;
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        const userA = await newTestUser(this.config.homeserverUrl, { name: { contains: "a" } });
        const userB = await newTestUser(this.config.homeserverUrl, { name: { contains: "b" } });
        const userC = await newTestUser(this.config.homeserverUrl, { name: { contains: "c" } });
        const userBId = await userB.getUserId();
        const userCId = await userC.getUserId();
        this.moderator = moderator;
        this.userA = userA;
        this.userB = userB;
        this.userC = userC;
        let powerLevels: any;

        await moderator.joinRoom(this.mjolnir.managementRoomId);
        LogService.debug("makeadminTest", `Joining managementRoom: ${this.mjolnir.managementRoomId}`);
        let targetRoom = await userA.createRoom({ invite: [userBId, userCId] });
        LogService.debug("makeadminTest", `User A creating targetRoom: ${targetRoom}; and inviting ${userBId} and ${userCId}`);
        try {
            await userB.start();
            await userC.start();
            await userB.joinRoom(targetRoom);
            await userC.joinRoom(targetRoom);
        } finally {
            LogService.debug("makeadminTest", `${userBId} and ${userCId} joining targetRoom: ${targetRoom}`);
            await userB.stop();
            await userC.stop();
        }
        try {
            await moderator.start();
            powerLevels = await userA.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
            assert.notEqual(powerLevels["users"][userBId], 100, `User B should not yet be an admin of ${targetRoom}`);
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                LogService.debug("makeadminTest", `Sending: !mjolnir make admin ${targetRoom} ${userBId}`);
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir make admin ${targetRoom} ${userBId}` });
            });
        } finally {
            await moderator.stop();
        }
        LogService.debug("makeadminTest", `Making User B admin`);

        powerLevels = await userA.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        assert.equal(powerLevels["users"][userBId], 100, "User B should be a room admin.");
        assert.equal(powerLevels["users"][userCId], (0 || undefined), "User C is not supposed to be a room admin.");
    });
});
