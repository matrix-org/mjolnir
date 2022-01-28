import { strict as assert } from "assert";
import { newTestUser, overrideRatelimitForUser, resetRatelimitForUser } from "./clientHelper";
import { getMessagesByUserIn } from "../../src/utils";
import { getFirstReaction } from "./commands/commandUtils";

describe("Test: throttled users can function with Mjolnir.", function () {
    it('throttled users survive being throttled by synapse', async function() {
        this.timeout(60000);
        let throttledUser = await newTestUser({ name: { contains: "throttled" }, isThrottled: true });
        let throttledUserId = await throttledUser.getUserId();
        let targetRoom = await throttledUser.createRoom();
        // send enough messages to hit the rate limit.
        await Promise.all([...Array(150).keys()].map((i) => throttledUser.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Message #${i}`})));
        let messageCount = 0;
        await getMessagesByUserIn(throttledUser, throttledUserId, targetRoom, 150, (events) => {
            messageCount += events.length;
        });
        assert.equal(messageCount, 150, "There should have been 150 messages in this room");
    })
})

describe("Test: Mjolnir can still sync and respond to commands while throttled", function () {
    beforeEach(async function() {
        await resetRatelimitForUser(await this.mjolnir.client.getUserId())
    })
    afterEach(async function() {
        // If a test has a timeout while awaitng on a promise then we never get given control back.
        this.moderator?.stop();

        await overrideRatelimitForUser(await this.mjolnir.client.getUserId());
    })

    it('Can still perform and respond to a redaction command', async function () {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser({ name: { contains: "spammer-needs-redacting" } });
        let badUserId = await badUser.getUserId();
        const mjolnir = this.mjolnir.client;
        let mjolnirUserId = await mjolnir.getUserId();
        let moderator = await newTestUser({ name: { contains: "moderator" } });
        this.moderator = moderator;
        await moderator.joinRoom(this.mjolnir.managementRoomId);
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId(), mjolnirUserId]});
        await moderator.setUserPowerLevel(mjolnirUserId, targetRoom, 100);
        await badUser.joinRoom(targetRoom);

        // Give Mjolnir some work to do and some messages to sync through.
        await Promise.all([...Array(100).keys()].map((i) => moderator.sendMessage(this.mjolnir.managementRoomId, {msgtype: 'm.text.', body: `Irrelevant Message #${i}`})));
        await Promise.all([...Array(50).keys()].map(_ => moderator.sendMessage(this.mjolnir.managementRoomId, {msgtype: 'm.text', body: '!mjolnir status'})));

        await moderator.sendMessage(this.mjolnir.managementRoomId, {msgtype: 'm.text', body: `!mjolnir rooms add ${targetRoom}`});

        await Promise.all([...Array(50).keys()].map((i) => badUser.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Bad Message #${i}`})));

        try {
            await moderator.start();
            await getFirstReaction(moderator, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir redact ${badUserId} ${targetRoom}` });
            });
        } finally {
            moderator.stop();
        }

        let count = 0;
        await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, function(events) {
            count += events.length
            events.map(e => {
                if (e.type === 'm.room.member') {
                    assert.equal(Object.keys(e.content).length, 1, "Only membership should be left on the membership event when it has been redacted.")
                } else if (Object.keys(e.content).length !== 0) {
                    throw new Error(`This event should have been redacted: ${JSON.stringify(e, null, 2)}`)
                }
            })
        });
        assert.equal(count, 51, "There should be exactly 51 events from the spammer in this room.");
    })
})
