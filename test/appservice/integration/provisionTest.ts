import { readTestConfig, setupHarness } from "../utils/harness";
import { newTestUser } from "../../integration/clientHelper";
import { getFirstReply } from "../../integration/commands/commandUtils";
import { MatrixClient } from "matrix-bot-sdk";
import { MjolnirAppService } from "../../../src/appservice/AppService";
import PolicyList from "../../../src/models/PolicyList";
import { CreateEvent } from "matrix-bot-sdk";

interface Context extends Mocha.Context {
    user?: MatrixClient,
    appservice?:  MjolnirAppService
}

afterEach(function(this: Context) {
    this.user?.stop();
    // something still runs, and i'm not sure what? -- ignoring with --exit.
    this.appservice?.close();
});

async function isPolicyRoom(user: MatrixClient, roomId: string): Promise<boolean> {
    const createEvent = new CreateEvent(await user.getRoomStateEvent(roomId, "m.room.create", ""));
    return PolicyList.ROOM_TYPE_VARIANTS.includes(createEvent.type);
}

describe("Test that the app service can provision a mjolnir on invite of the appservice bot", function () {
    it("", async function (this: Context) {
        const config = readTestConfig();
        this.appservice = await setupHarness();
        // create a user
        const user = await newTestUser(config.homeserver.url, { name: { contains: "test" } });
        const roomWeWantProtecting = await user.createRoom();
        // have the user invite the appservice bot
        this.user = user;
        const roomsInvitedTo: string[] = [];
        await new Promise(async resolve => {
            user.on('room.invite', (roomId: string) => {
                roomsInvitedTo.push(roomId)
                // the appservice should invite it to a policy room and a management room.
                if (roomsInvitedTo.length === 2) {
                    resolve(null);
                }
            });
            await user.start();
            await user.inviteUser(this.appservice!.bridge.getBot().getUserId(), roomWeWantProtecting);
        });
        await Promise.all(roomsInvitedTo.map(roomId => user.joinRoom(roomId)));
        const managementRoomId = roomsInvitedTo.filter(async roomId => !(await isPolicyRoom(user, roomId)))[0];
        await getFirstReply(user, managementRoomId, () => {
            return user.sendMessage(managementRoomId, { body: `!mjolnir status`, msgtype: 'm.text' });
        })
    })
})
