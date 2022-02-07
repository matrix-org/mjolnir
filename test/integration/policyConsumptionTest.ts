import { strict as assert } from "assert";

import { newTestUser } from "./clientHelper";
import config from "../../src/config";
import { getRequestFn, LogService, MatrixClient } from "matrix-bot-sdk";
import { createBanList, getFirstReaction } from "./commands/commandUtils";

/**
 * Get a copy of the rules from the ruleserver.
 */
async function currentRules(): Promise<{ start: object, stop: object, since: string }> {
    return await new Promise((resolve, reject) => getRequestFn()({
        uri: `http://${config.web.address}:${config.web.port}/api/1/ruleserver/updates/`,
        method: "GET"
    }, (error, response, body) => {
        if (error) {
            reject(error)
        } else {
            resolve(JSON.parse(body))
        }
    }));
}

/**
 * Wait for the rules to change as a result of the thunk. The returned promise will resolve when the rules being served have changed.
 * @param thunk Should cause the rules the RuleServer is serving to change some way.
 */
async function waitForRuleChange(thunk): Promise<void> {
    const initialRules = await currentRules();
    let rules = initialRules;
    // We use JSON.stringify like this so that it is pretty printed in the log and human readable.
    LogService.debug('policyConsumptionTest', `Rules before we wait for them to change: ${JSON.stringify(rules, null, 2)}`);
    await thunk();
    while (rules.since === initialRules.since) {
        await new Promise<void>(resolve => {
            setTimeout(resolve, 500);
        })
        rules = await currentRules();
    };
    // The problem is, we have no idea how long a consumer will take to process the changed rules.
    // We know the pull peroid is 1 second though.
    await new Promise<void>(resolve => {
        setTimeout(resolve, 1500);
    })
    LogService.debug('policyConsumptionTest', `Rules after they have changed: ${JSON.stringify(rules, null, 2)}`);
}

describe("Test: that policy lists are consumed by the associated synapse module", function () {
    this.afterEach(async function () {
        if(config.web.ruleServer.enabled) {
            this.timeout(5000)
            LogService.debug('policyConsumptionTest', `Rules at end of test ${JSON.stringify(await currentRules(), null, 2)}`);
            const mjolnir = config.RUNTIME.client!;
            // Clear any state associated with the account.
            await mjolnir.setAccountData('org.matrix.mjolnir.watched_lists', {
                references: [],
            });
        }
    })
    this.beforeAll(async function() {
        if (!config.web.ruleServer.enabled) {
            LogService.warn("policyConsumptionTest", "Skipping policy consumption test because the ruleServer is not enabled")
            this.skip();
        }
    })
    this.beforeEach(async function () {
        this.timeout(1000);
        const mjolnir = config.RUNTIME.client!;
    })
    it('blocks users in antispam when they are banned from sending messages and invites serverwide.', async function() {
        this.timeout(20000);
        // Create a few users and a room.
        let badUser = await newTestUser({ name: { contains: "spammer" }});
        let badUserId = await badUser.getUserId();
        const mjolnir = config.RUNTIME.client!
        let mjolnirUserId = await mjolnir.getUserId();
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        this.moderator = moderator;
        await moderator.joinRoom(this.mjolnir.managementRoomId);
        let unprotectedRoom = await badUser.createRoom({ invite: [await moderator.getUserId()]});
        // We do this so the moderator can send invites, no other reason.
        await badUser.setUserPowerLevel(await moderator.getUserId(), unprotectedRoom, 100);
        await moderator.joinRoom(unprotectedRoom);
        const banList = await createBanList(this.mjolnir.managementRoomId, mjolnir, moderator);
        await badUser.sendMessage(unprotectedRoom, {msgtype: 'm.text', body: 'Something bad and mean'});

        await waitForRuleChange(async () => {
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir ban ${banList} ${badUserId}` });
            });
        });
        await assert.rejects(badUser.sendMessage(unprotectedRoom, { msgtype: 'm.text', body: 'test'}), 'The bad user should be banned and unable to send messages.');
        await assert.rejects(badUser.inviteUser(mjolnirUserId, unprotectedRoom), 'They should also be unable to send invitations.');
        assert.ok(await moderator.inviteUser('@test:localhost:9999', unprotectedRoom), 'The moderator is not banned though so should still be able to invite');
        assert.ok(await moderator.sendMessage(unprotectedRoom, { msgtype: 'm.text', body: 'test'}), 'They should be able to send messages still too.');

        // Test we can remove the rules.
        await waitForRuleChange(async () => {
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir unban ${banList} ${badUserId}` });
            });
        });
        assert.ok(await badUser.sendMessage(unprotectedRoom, { msgtype: 'm.text', body: 'test'}));
        assert.ok(await badUser.inviteUser(mjolnirUserId, unprotectedRoom));
    })
    it('Test: Cannot send message to a room that is listed in a policy list and cannot invite a user to the room either', async function () {
        this.timeout(20000);
        let badUser = await newTestUser({ name: { contains: "spammer" }});
        const mjolnir = config.RUNTIME.client!
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        await moderator.joinRoom(this.mjolnir.managementRoomId);
        const banList = await createBanList(this.mjolnir.managementRoomId, mjolnir, moderator);
        let badRoom = await badUser.createRoom();
        let unrelatedRoom = await badUser.createRoom();
        await badUser.sendMessage(badRoom, {msgtype: 'm.text', body: "Very Bad Stuff in this room"});
        await waitForRuleChange(async () => {
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir ban ${banList} ${badRoom}` });
            });
        });
        await assert.rejects(badUser.sendMessage(badRoom, { msgtype: 'm.text', body: 'test'}), 'should not be able to send messagea to a room which is listed.');
        await assert.rejects(badUser.inviteUser(await moderator.getUserId(), badRoom), 'should not be able to invite people to a listed room.');
        assert.ok(await badUser.sendMessage(unrelatedRoom, { msgtype: 'm.text.', body: 'hey'}), 'should be able to send messages to unrelated room');
        assert.ok(await badUser.inviteUser(await moderator.getUserId(), unrelatedRoom), 'They should still be able to invite to other rooms though');
        // Test we can remove these rules.
        await waitForRuleChange(async () => {
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir unban ${banList} ${badRoom}` });
            });
        });

        assert.ok(await badUser.sendMessage(badRoom, { msgtype: 'm.text', body: 'test'}), 'should now be able to send messages to the room.');
        assert.ok(await badUser.inviteUser(await moderator.getUserId(), badRoom), 'should now be able to send messages to the room.');
    })
    it('Test: When a list becomes unwatched, the associated policies are stopped.', async function () {
        this.timeout(20000);
        const mjolnir = config.RUNTIME.client!
        let moderator = await newTestUser({ name: { contains: "moderator" }});
        await moderator.joinRoom(this.mjolnir.managementRoomId);
        const banList = await createBanList(this.mjolnir.managementRoomId, mjolnir, moderator);
        let targetRoom = await moderator.createRoom();
        await moderator.sendMessage(targetRoom, {msgtype: 'm.text', body: "Fluffy Foxes."});
        await waitForRuleChange(async () => {
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir ban ${banList} ${targetRoom}` });
            });
        });
        await assert.rejects(moderator.sendMessage(targetRoom, { msgtype: 'm.text', body: 'test'}), 'should not be able to send messages to a room which is listed.');

        await waitForRuleChange(async () => {
            await getFirstReaction(mjolnir, this.mjolnir.managementRoomId, '✅', async () => {
                return await moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir unwatch #${banList}:localhost:9999` });
            });
        });

        assert.ok(await moderator.sendMessage(targetRoom, { msgtype: 'm.text', body: 'test'}), 'should now be able to send messages to the room.');
    })
});
