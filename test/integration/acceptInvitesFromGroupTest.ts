import { strict as assert } from "assert";

import config from "../../src/config";
import { newTestUser } from "./clientHelper";

describe("Test: Accept Invites From Space", function() {
    let client;
    this.beforeEach(async function () {
        client = await newTestUser({ name: { contains: "spacee" }});
        await client.start();
    })
    this.afterEach(async function () {
        await client.stop();
    })
    it("Mjolnir should accept an invite from a user in a nominated Space", async function() {
        this.timeout(20000);

        const mjolnirUserId = await this.mjolnir.client.getUserId();

        const space = await client.createSpace({
            name: "mjolnir space invite test",
            invites: [mjolnirUserId],
        });

        await this.mjolnir.client.joinRoom(space.roomId);

        // we're mutating a static object, which may affect other tests :(
        config.autojoinOnlyIfManager = false;
        config.acceptInvitesFromSpace = space.roomId;

        const promise = new Promise(async (resolve, reject) => {
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

