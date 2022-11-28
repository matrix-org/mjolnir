import { isPolicyRoom, readTestConfig, setupHarness } from "../utils/harness";
import { newTestUser } from "../../integration/clientHelper";
import { getFirstReply } from "../../integration/commands/commandUtils";
import { MatrixClient } from "matrix-bot-sdk";
import { MjolnirAppService } from "../../../src/appservice/AppService";

interface Context extends Mocha.Context {
    moderator?: MatrixClient,
    appservice?:  MjolnirAppService
}

describe("Test that the app service can provision a mjolnir on invite of the appservice bot", function () {
    afterEach(function(this: Context) {
        this.moderator?.stop();
        if (this.appservice) {
            return this.appservice.close();
        } else {
            console.warn("Missing Appservice in this context, so cannot stop it.")
            return Promise.resolve(); // TS7030: Not all code paths return a value.
        }
    });
    it("A moderator that requests a mjolnir via a matrix invitation will be invited to a new policy and management room", async function (this: Context) {
        const config = readTestConfig();
        this.appservice = await setupHarness();
        // create a user to act as the moderator
        const moderator = await newTestUser(config.homeserver.url, { name: { contains: "test" } });
        const roomWeWantProtecting = await moderator.createRoom();
        // have the moderator invite the appservice bot in order to request a new mjolnir
        this.moderator = moderator;
        const roomsInvitedTo: string[] = [];
        await new Promise(async resolve => {
            moderator.on('room.invite', (roomId: string) => {
                roomsInvitedTo.push(roomId)
                // the appservice should invite the moderator to a policy room and a management room.
                if (roomsInvitedTo.length === 2) {
                    resolve(null);
                }
            });
            await moderator.start();
            await moderator.inviteUser(this.appservice!.bridge.getBot().getUserId(), roomWeWantProtecting);
        });
        await Promise.all(roomsInvitedTo.map(roomId => moderator.joinRoom(roomId)));
        const managementRoomId = roomsInvitedTo.filter(async roomId => !(await isPolicyRoom(moderator, roomId)))[0];
        // Check that the newly provisioned mjolnir is actually responsive.
        await getFirstReply(moderator, managementRoomId, () => {
            return moderator.sendMessage(managementRoomId, { body: `!mjolnir status`, msgtype: 'm.text' });
        })
    })
})
