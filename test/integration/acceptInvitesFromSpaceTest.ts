import { MatrixClient } from "matrix-bot-sdk";
import { Mjolnir } from "../../src/Mjolnir"
import { newTestUser } from "./clientHelper";

describe("Test: Accept Invites From Space", function() {
    let client: MatrixClient|undefined;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "spacee" }});
        await client.start();
    })
    this.afterEach(async function () {
        await client.stop();
    })
    it("Mjolnir should accept an invite from a user in a nominated Space", async function() {
        this.timeout(20000);

        const mjolnir: Mjolnir = this.mjolnir!;
        const mjolnirUserId = await mjolnir.client.getUserId();

        const space = await client.createSpace({
            name: "mjolnir space invite test",
            invites: [mjolnirUserId],
            isPublic: false
        });

        await this.mjolnir.client.joinRoom(space.roomId);

        // we're mutating a static object, which may affect other tests :(
        mjolnir.config.autojoinOnlyIfManager = false;
        mjolnir.config.acceptInvitesFromSpace = space.roomId;

        const promise = new Promise(async resolve => {
            const newRoomId = await client.createRoom({ invite: [mjolnirUserId] });
            client.on("room.event", (roomId, event) => {
                if (
                    roomId === newRoomId
                    && event.type === "m.room.member"
                    && event.sender === mjolnirUserId
                    && event.content?.membership === "join"
                ) {
                    resolve(null);
                }
            });
        });
        await promise;
    });
});

