import { strict as assert } from "assert";
import { newTestUser } from "./clientHelper";
import { getMessagesByUserIn } from "../../src/utils";

describe("Test: throttled users can function with Mjolnir.", function () {
    it('Test throttled users survive being throttled by synapse', async function() {
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