import { strict as assert } from "assert";

import config from "../../../src/config";
import { newTestUser } from "../clientHelper";
import { LogService } from "matrix-bot-sdk";
import { getFirstReaction } from "./commandUtils";

describe("Test: The make admin command", function () {
    it('make Mjölnir the room administrator by "hijacking" a room via the Synapse admin API.', async function () {
        this.timeout(90000);
        if (!config.admin?.enableMakeRoomAdminCommand) {
            LogService.warn("makedminCommandTest", `SKIPPING because the make room admin command is disabled`);
            this.skip();
        }
        const mjolnir = config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        const unrelatedUser = await newTestUser({ name: { contains: "new-admin" } });
        const unrelatedUserId = await unrelatedUser.getUserId();

        await moderator.joinRoom(config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId], preset: "public_chat" });
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text.', body: `!mjolnir rooms add ${targetRoom}` });

        await unrelatedUser.joinRoom(targetRoom);
        let powerLevels = await mjolnir.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        assert.notEqual(powerLevels["users"][mjolnirUserId], 100, `Bot should not yet be an admin of ${targetRoom}`);
        await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
            return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir make admin ${targetRoom}` });
        });
        LogService.debug("makeadminTest", `Making self admin`);

        powerLevels = await mjolnir.getRoomStateEvent(targetRoom, "m.room.power_levels", "");
        assert.equal(powerLevels["users"][mjolnirUserId], 100, "Bot should be a room admin.");
        assert.equal(powerLevels["users"][unrelatedUserId], (0 || undefined), "User A is not supposed to be a room admin.");
    });
});
