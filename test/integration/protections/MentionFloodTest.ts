import { LogService } from "matrix-bot-sdk";
import config from "../../../src/config";
import { newTestUser } from "../clientHelper";
import { getFirstReaction, getFirstReply } from "../commands/commandUtils";
import { strict as assert } from "assert";
import { checkMembershipChange, getFirstMessage } from "./protectionUtils";

// Produces generic "spam" events.
const produceRandomSpam = async (userA, targetRoom) => {
    // Generate random "spam"
    for (let i = 0; i < 10000; i++) {
        let randomMessageThatIsSpammy = (Math.random() + 1).toString(36).substring(7);
        await userA.sendMessage(targetRoom, { msgtype: 'm.text', body: `${randomMessageThatIsSpammy}` });
    }
};

describe("Test: MentionFlood protection", function () {
    afterEach(function () {
        this.moderator?.stop();
        this.userA?.stop();
    });

    // Tests if enabling the protection works
    it('Enabling the MentionFlood protection works', async function () {
        // Create users
        const mjolnir = config.RUNTIME.client!;
        const moderator = await newTestUser({ name: { contains: "moderator" } });

        this.moderator = moderator;

        // Join managementroom
        await moderator.joinRoom(config.managementRoom);
        LogService.debug("MentionFloodTest", `Joining managementRoom: ${config.managementRoom}`);

        try {
            await moderator.start();
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                LogService.debug("MentionFloodTest", `Enabling MentionFlood protection next`);
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir enable MentionFlood` });
            });
        } finally {
            await moderator.stop();
        }

    });

    // Tests that regular spam isnt triggering this
    it('Regular flooding should not be detected by MentionFlood Protection', async function () {
        // Create users
        const mjolnir = config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        const userA = await newTestUser({ name: { contains: "a" } });

        this.moderator = moderator;
        this.userA = userA;

        // Join managementroom and setup target room
        await moderator.joinRoom(config.managementRoom);
        LogService.debug("MentionFloodTest", `Joining managementRoom: ${config.managementRoom}`);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId] });
        LogService.debug("MentionFloodTest", `moderator creating targetRoom: ${targetRoom}; and inviting ${mjolnirUserId}`);
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${targetRoom}` });
        LogService.debug("MentionFloodTest", `Adding targetRoom: ${targetRoom}`);
        try {
            await moderator.start();
            await userA.start();
            await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir enable MentionFlood` });
            LogService.debug("MentionFloodTest", `Enabling MentionFlood protection`);

            // Idea here is that we send spam to the room and then get the mjolnir status as a test case.
            // If everything goes well we should only see the status in the management room and no spam warnings.
            const statusResp = await getFirstMessage(this.mjolnir, this.mjolnir.managementRoom, async () => {
                await produceRandomSpam(userA, targetRoom);
                return await moderator.sendMessage(this.mjolnir.managementRoom, { msgtype: 'm.text', body: `!mjolnir` });
            });
            assert.equal(statusResp.content.body.includes('Protected rooms: 1'), true, 'unexpected message from mjolnir while fake spamming');
        } finally {
            await moderator.stop();
            await userA.stop();
        }
    });

    // Tests that normal mentions do not trigger the protection
    it('Regular mentions should not be detected by MentionFlood Protection', async function () {
        // Create users
        const mjolnir = config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        const userA = await newTestUser({ name: { contains: "a" } });

        this.moderator = moderator;
        this.userA = userA;

        // Join managmentroom and setup targget room
        await moderator.joinRoom(config.managementRoom);
        LogService.debug("MentionFloodTest", `Joining managementRoom: ${config.managementRoom}`);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId] });
        LogService.debug("MentionFloodTest", `moderator creating targetRoom: ${targetRoom}; and inviting ${mjolnirUserId}`);
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${targetRoom}` });
        LogService.debug("MentionFloodTest", `Adding targetRoom: ${targetRoom}`);

        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir enable MentionFlood` });
        LogService.debug("MentionFloodTest", `Enabling MentionFlood protection`);


        await moderator.start();
        await userA.start();

        // Mention a user (a non existent is fine as we dont check for existence of users)
        // We use the mjolnir status as a test case. We shouldnt see any other messages happen.
        const statusResp = await getFirstMessage(this.mjolnir, this.mjolnir.managementRoom, async () => {
            await userA.sendMessage(targetRoom, { msgtype: 'm.text', body: `@random:test.server Test Mention` });
            return await moderator.sendMessage(this.mjolnir.managementRoom, { msgtype: 'm.text', body: `!mjolnir` });
        });
        assert.equal(statusResp.content.body.includes('Protected rooms: 1'), true, 'unexpected message from mjolnir while fake spamming');
    });

    // Tests that html mentions over the limit should be reacted upon
    it('HTML mentions (pills) over the limit should be detected by MentionFlood Protection', async function () {
        // Create users
        const mjolnir = config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        const userA = await newTestUser({ name: { contains: "a" } });

        this.moderator = moderator;
        this.userA = userA;

        // Join managmentroom and setup targget room
        await moderator.joinRoom(config.managementRoom);
        LogService.debug("MentionFloodTest", `Joining managementRoom: ${config.managementRoom}`);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId] });
        LogService.debug("MentionFloodTest", `moderator creating targetRoom: ${targetRoom}; and inviting ${mjolnirUserId}`);
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${targetRoom}` });
        LogService.debug("MentionFloodTest", `Adding targetRoom: ${targetRoom}`);

        let textMessage = "";
        let htmlMessage = "<p>";
        for (let i = 0; i < 30; i++) {
            let randomUsername = (Math.random() + 1).toString(36).substring(7);
            textMessage = `${textMessage} ${randomUsername}`;
            htmlMessage = `${htmlMessage} <del><a href=\"https://matrix.to/#/@${randomUsername}:test.server\">${randomUsername}</a>`;
        }
        htmlMessage = `${htmlMessage}</p>`;
        const actionTakenResponse = await getFirstReply(mjolnir, this.mjolnir.managementRoom, async () => {
            return await userA.sendMessage(targetRoom, { msgtype: 'm.text', body: textMessage, format: "org.matrix.custom.html", formatted_body: htmlMessage });
        });
        assert.equal(actionTakenResponse.content.body.includes(`Banning ${await userA.getUserId()} for mention flood violation in ${targetRoom}.`), true, 'protection did not log protecting against mention spam.');
    });

    // Tests that text mentions over the limit should be reacted upon.
    // This is intentionally a mention with mxid as this is based on real world spam from the past.
    it('Text mentions (non pills) over the limit should be detected by MentionFlood Protection (if it is a mxid)', async function () {
        // Create users
        const mjolnir = config.RUNTIME.client!;
        const mjolnirUserId = await mjolnir.getUserId();
        const moderator = await newTestUser({ name: { contains: "moderator" } });
        const userA = await newTestUser({ name: { contains: "a" } });

        this.moderator = moderator;
        this.userA = userA;

        // Join managmentroom and setup targget room
        await moderator.joinRoom(config.managementRoom);
        LogService.debug("MentionFloodTest", `Joining managementRoom: ${config.managementRoom}`);
        let targetRoom = await moderator.createRoom({ invite: [mjolnirUserId] });
        LogService.debug("MentionFloodTest", `moderator creating targetRoom: ${targetRoom}; and inviting ${mjolnirUserId}`);
        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${targetRoom}` });
        LogService.debug("MentionFloodTest", `Adding targetRoom: ${targetRoom}`);

        await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir enable MentionFlood` });
        LogService.debug("MentionFloodTest", `Enabling MentionFlood protection`);

        let textMessage = "";
        for (let i = 0; i < 30; i++) {
            let randomUsername = (Math.random() + 1).toString(36).substring(7);
            textMessage = `${textMessage} @${randomUsername}:test.server`;
        }
        const actionTakenResponse = await getFirstReply(mjolnir, this.mjolnir.managementRoom, async () => {
            return await userA.sendMessage(targetRoom, { msgtype: 'm.text', body: textMessage });
        });
        assert.equal(actionTakenResponse.content.body.includes(`Banning ${await userA.getUserId()} for mention flood violation in ${targetRoom}.`), true, 'protection did not log protecting against mention spam.');
        const membershipResp = await checkMembershipChange(mjolnir, targetRoom, await userA.getUserId(), "ban");
        assert.equal(membershipResp, true, 'user was not banned from target room');
    });
});