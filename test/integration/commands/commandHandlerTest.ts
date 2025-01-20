import { newTestUser } from "../clientHelper";
import { getFirstReply } from "./commandUtils";
import expect from "expect";

describe("Test: General command handling test", function () {
    afterEach(function () {
        this.userA?.stop();
    });

    it("Mjölnir ignores commands outside of the admin room", async function () {
        const mjolnirUserId = await this.config.RUNTIME.client!.getUserId();
        this.moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        await this.moderator.joinRoom(this.mjolnir.managementRoomId);
        this.userA = await newTestUser(this.config.homeserverUrl, { name: { contains: "a" } });
        this.userA.start();
        const publicRoomId = await this.userA.createRoom({
            visibility: "public",
        });
        await this.moderator.sendText(this.mjolnir.managementRoomId, `!mjolnir rooms add ${publicRoomId}`);
        const joinPromise = new Promise<void>((resolve) =>
            this.userA.on("room.event", (roomId, evt) => {
                if (
                    roomId === publicRoomId &&
                    evt.type === "m.room.member" &&
                    evt.state_key === mjolnirUserId &&
                    evt.content.membership === "join"
                ) {
                    resolve();
                }
            }),
        );
        await this.userA.inviteUser(mjolnirUserId, publicRoomId);
        await joinPromise;
        await this.userA.sendText(publicRoomId, "!mjolnir enable MentionSpam");

        const reply = new Promise<null | unknown>((resolve, reject) => {
            // Mjolnir should ignore our message entirely.
            setTimeout(() => resolve(null), 10000);
            getFirstReply(this.userA, publicRoomId, () => this.userA.sendText(publicRoomId, "!mjolnir status"))
                .then(resolve)
                .catch(reject);
        });

        expect(await reply).toBeNull();
    });
});
