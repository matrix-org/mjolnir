import { strict as assert } from "assert";

import config from "../../../src/config";
import { newTestUser } from "../clientHelper";
import { PowerLevelAction } from "matrix-bot-sdk/lib/models/PowerLevelAction";
import { getFirstReaction } from "./commandUtils";

describe("Test: The make admin command", function () {
    // If a test has a timeout while awaitng on a promise then we never get given control back.
    afterEach(function () { this.moderator ?.stop(); });

    it('Mjölnir make the bot self room administrator and some other tester too', async function () {
        this.timeout(60000);
        const mjolnir = config.RUNTIME.client!
        let mjolnirUserId = await mjolnir.getUserId();
        let moderator = await newTestUser({ name: { contains: "moderator" } });
        let tester = await newTestUser({ name: { contains: "tester" } });
        let testerUserId = await tester.getUserId();
        this.moderator = moderator;
        this.tester = tester;
        await moderator.joinRoom(config.managementRoom);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId, testerUserId] });
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text.', body: `!mjolnir rooms add ${targetRoom}` });
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text.', body: `!mjolnir make admin ${targetRoom}` });
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text.', body: `!mjolnir make admin ${targetRoom} ${tester.getUserId()}` });

        assert.ok(await mjolnir.userHasPowerLevelForAction(mjolnirUserId, targetRoom, PowerLevelAction.Ban), "Bot user is now room admin.");
        assert.ok(await mjolnir.userHasPowerLevelForAction(testerUserId, targetRoom, PowerLevelAction.Ban), "Tester user is now room admin.");
    });
});
