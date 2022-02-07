import { strict as assert } from "assert";

import { newTestUser } from "./clientHelper";
import { getMessagesByUserIn } from "../../src/utils";

/**
 * Ensure that Mjolnir paginates only the necessary segment of the room timeline when backfilling.
 */
describe("Test: timeline pagination", function () {
    it('does not paginate across the entire room history while backfilling.', async function() {
        this.timeout(60000);
        // Create a few users and a room.
        let badUser = await newTestUser({ name: { contains: "spammer" }});
        let badUserId = await badUser.getUserId();
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId()]});
        await badUser.joinRoom(targetRoom);

        // send some irrelevant messages
        await Promise.all([...Array(200).keys()].map((i) => moderator.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Irrelevant Message #${i}`})));
        // bad guy sends 5 messages
        for (let i = 0; i < 5; i++) {
            await badUser.sendMessage(targetRoom, {msgtype: 'm.text', body: "Very Bad Stuff"});
        }
        // send some irrelevant messages
        await Promise.all([...Array(50).keys()].map((i) => moderator.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Irrelevant Message #${i}`})));
        // bad guy sends 1 extra message at the most recent edge of the timeline.
        await badUser.sendMessage(targetRoom, {msgtype: 'm.text', body: "Very Bad Stuff"});
        // then call this paignator and ensure that we don't go across the entire room history.
        let cbCount = 0;
        let eventCount = 0;
        await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, function(events) {
            cbCount += 1;
            eventCount += events.length;
            events.map(e => assert.equal(e.sender, badUserId, "All the events should be from the same sender"));
        });
        assert.equal(cbCount, 1, "The callback only needs to be called once with all the messages because the events should be filtered.");
        assert.equal(eventCount, 7, "There shouldn't be any more events (1 member event and 6 messages), and they should all be from the same account.");
    })
    it('does not call the callback with an empty array when there are no relevant events', async function() {
        this.timeout(60000);
        let badUser = await newTestUser({ name: { contains: "spammer" }});
        let badUserId = await badUser.getUserId();
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        let targetRoom = await moderator.createRoom();
        // send some irrelevant messages
        await Promise.all([...Array(200).keys()].map((i) => moderator.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Irrelevant Message #${i}`})));
        // The callback should not be called.
        let cbCount = 0;
        await getMessagesByUserIn(moderator, badUserId, targetRoom, 1000, (events) => {
            cbCount += 1;
        });
        assert.equal(cbCount, 0, "The callback should never get called");
    })
    it("The limit provided is respected", async function() {
        this.timeout(60000);
        let badUser = await newTestUser({ name: { contains: "spammer" }});
        let badUserId = await badUser.getUserId();
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        let targetRoom = await moderator.createRoom({ invite: [await badUser.getUserId()]});
        await badUser.joinRoom(targetRoom);
        // send some bad person messages
        // bad guy sends 5 messages at the start of the timeline
        for (let i = 0; i < 5; i++) {
            await badUser.sendMessage(targetRoom, {msgtype: 'm.text', body: "Very Bad Stuff"});
        }
        // send some irrelevant messages
        await Promise.all([...Array(200).keys()].map((i) => moderator.sendMessage(targetRoom, {msgtype: 'm.text.', body: `Irrelevant Message #${i}`})));
        let cbCount = 0;
        await getMessagesByUserIn(moderator, "*spammer*", targetRoom, 200, (events) => {
            cbCount += 1;
        });
        // Remember that the limit is the number of events that getMessagesByUserIn has checked against the glob,
        // not the number of events to provide to the callback.
        // E.g. we don't want to paginate to the beginning of history just because less than 200 events match the glob,
        // which is very likely if a user has only just started sending messages.
        assert.equal(cbCount, 0, "The callback should never be called as the limit should be reached beforehand.");
        await getMessagesByUserIn(moderator, "*spammer*", targetRoom, 205, (events) => {
            cbCount += 1;
            events.map(e => assert.equal(e.sender, badUserId, "All the events should be from the same sender"));
        });
        assert.equal(cbCount, 1, "The callback should be called once with events matching the glob.");
    });
    it("Gives the events to the callback ordered by youngest first (even more important when the limit is reached halfway through a chunk).", async function() {
        this.timeout(60000);
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        let moderatorId = await moderator.getUserId();
        let targetRoom = await moderator.createRoom();
        for (let i = 0; i < 20; i++) {
            await moderator.sendMessage(targetRoom, {msgtype: 'm.text.', body: `${i}`})
        }
        await getMessagesByUserIn(moderator, moderatorId, targetRoom, 5, (events) => {
            let messageNumbers = events.map(event => parseInt(event.content.body, 10));
            messageNumbers.map(n => assert.equal(n >= 15, true, "The youngest events should be given to the callback first."))
        });
    })
});
