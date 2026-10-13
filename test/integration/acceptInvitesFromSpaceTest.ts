import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { Mjolnir } from "../../src/Mjolnir";
import { newTestUser } from "./clientHelper";

describe("Test: Accept Invites From Space", function () {
    let client: MatrixClient | undefined;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "spacee" } });
        await client.start();
    });
    this.afterEach(async function () {
        await client.stop();
    });
    it("Mjolnir should accept an invite from a user in a nominated Space", async function () {
        this.timeout(20000);

        const mjolnir: Mjolnir = this.mjolnir!;
        const mjolnirUserId = await mjolnir.client.getUserId();

        // Not using `client.createSpace` as it puts the creator in the power level users,
        // which is rejected in room v12+ where creators have implicit power.
        const spaceId = await client.createRoom({
            name: "mjolnir space invite test",
            preset: "private_chat",
            creation_content: { type: "m.space" },
            invite: [mjolnirUserId],
        });

        await this.mjolnir.client.joinRoom(spaceId);

        // we're mutating a static object, which may affect other tests :(
        mjolnir.config.autojoinOnlyIfManager = false;
        mjolnir.config.acceptInvitesFromSpace = spaceId;

        const promise = new Promise(async (resolve) => {
            const newRoomId = await client.createRoom({ invite: [mjolnirUserId] });
            client.on("room.event", (roomId, event) => {
                if (
                    roomId === newRoomId &&
                    event.type === "m.room.member" &&
                    event.sender === mjolnirUserId &&
                    event.content?.membership === "join"
                ) {
                    resolve(null);
                }
            });
        });
        await promise;
    });
});
