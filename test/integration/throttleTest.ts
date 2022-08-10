import { strict as assert } from "assert";
import { newTestUser } from "./clientHelper";
import { getMessagesByUserIn } from "../../src/utils";

describe("Test: throttled users can function with Mjolnir.", function () {
    it('throttled users survive being throttled by synapse', async function() {
        let throttledUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "throttled" }, isThrottled: true });
        let throttledUserId = await throttledUser.getUserId();
        let targetRoom = await throttledUser.createRoom();
        // send enough messages to hit the rate limit.
        await Promise.all([...Array(25).keys()].map((i) => throttledUser.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Message #${i}`})));
        let messageCount = 0;
        await getMessagesByUserIn(throttledUser, throttledUserId, targetRoom, 25, (events) => {
            messageCount += events.length;
        });
        assert.equal(messageCount, 25, "There should have been 25 messages in this room");
    })
})

/**
 * We used to have a test here that tested whether Mjolnir was going to carry out a redact order the default limits in a reasonable time scale.
 * Now I think that's never going to happen without writing a new algorithm for respecting rate limiting.
 * Which is not something there is time for.
 * 
 * https://github.com/matrix-org/synapse/pull/13018
 * 
 * Synapse rate limits were broken and very permitting so that's why the current hack worked so well.
 * Now it is not broken, so our rate limit handling is.  
 * 
 * https://github.com/matrix-org/mjolnir/commit/b850e4554c6cbc9456e23ab1a92ede547d044241
 * 
 * Honestly I don't think we can expect anyone to be able to use Mjolnir under default rate limits.
 */
