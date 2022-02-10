import { strict as assert } from "assert";

import config from "../../../src/config";
import { newTestUser } from "../clientHelper";
import { PowerLevelAction } from "matrix-bot-sdk/lib/models/PowerLevelAction";
import { LogService } from "matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";

describe("Test: The make admin command", function () {
    afterEach(function () {
        this.moderator?.stop();
        this.userA?.stop();
        this.userB?.stop();
    });

    it('Mjölnir make the bot self room administrator', async function () {
        this.timeout(60000);
        const mjolnir = config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        this.moderator = moderator;
        let powerLevels: any;

        await moderator.joinRoom(config.managementRoom);
        LogService.debug("makeadminTest", `Joining managementRoom: ${config.managementRoom}`);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId] });
        LogService.debug("makeadminTest", `moderator creating targetRoom: ${targetRoom}; and inviting ${mjolnirUserId}`);
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text.', body: `!mjolnir rooms add ${targetRoom}` });
        LogService.debug("makeadminTest", `Adding targetRoom: ${targetRoom}`);
        try {
            await moderator.start();
            powerLevels = await mjolnir.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
            if (powerLevels["users"][mjolnirUserId] !== 0) {
                assert.fail(`Bot is already an admin of ${targetRoom}`);
            }
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                LogService.debug("makeadminTest", `Sending: !mjolnir make admin ${targetRoom}`);
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir make admin ${targetRoom}` });
            });
        } finally {
            await moderator.stop();
        }
        LogService.debug("makeadminTest", `Making self admin`);

        powerLevels = await mjolnir.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        assert.equal(powerLevels["users"][mjolnirUserId], 100, "Bot user is not room admin.");
    });

    it('Mjölnir make the tester room administrator', async function () {
        this.timeout(60000);
        const mjolnir = config.RUNTIME.client!;
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        const userA = await newTestUser({ name: { contains: "a" } });
        const userB = await newTestUser({ name: { contains: "b" } });
        const userBId = await userB.getUserId();
        this.moderator = moderator;
        this.userA = userA;
        this.userB = userB;
        let powerLevels: any;

        await moderator.joinRoom(this.mjolnir.managementRoomId);
        LogService.debug("makeadminTest", `Joining managementRoom: ${this.mjolnir.managementRoomId}`);
        let targetRoom = await userA.createRoom({ invite: [userBId] });
        LogService.debug("makeadminTest", `User A creating targetRoom: ${targetRoom}; and inviting ${userBId}`);
        try {
            await userB.start();
            userB.joinRoom(targetRoom);
        } finally {
            LogService.debug("makeadminTest", `${userBId} joining targetRoom: ${targetRoom}`);
            await userB.stop();
        }
        try {
            await moderator.start();
            powerLevels = await userA.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
            if (powerLevels["users"][userBId] !== 0) {
                assert.fail(`Bot is already an admin of ${targetRoom}`);
            }
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                LogService.debug("makeadminTest", `Sending: !mjolnir make admin ${targetRoom} ${userBId}`);
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir make admin ${targetRoom} ${userBId}` });
            });
        } finally {
            await moderator.stop();
        }
        LogService.debug("makeadminTest", `Making User B admin`);

        powerLevels = await userA.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        assert.equal(powerLevels, 100, "User B is not room admin.");
    });
});
