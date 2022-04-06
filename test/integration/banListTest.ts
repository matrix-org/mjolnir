import { strict as assert } from "assert";

import config from "../../src/config";
import { newTestUser } from "./clientHelper";
import { LogService, MatrixClient, Permalinks, UserID } from "matrix-bot-sdk";
import  BanList, { ALL_RULE_TYPES, ChangeType, ListRuleChange, RULE_SERVER, RULE_USER, SERVER_RULE_TYPES } from "../../src/models/BanList";
import { ServerAcl } from "../../src/models/ServerAcl";
import { getFirstReaction } from "./commands/commandUtils";
import { getMessagesByUserIn } from "../../src/utils";

/**
 * Create a policy rule in a policy room.
 * @param client A matrix client that is logged in
 * @param policyRoomId The room id to add the policy to.
 * @param policyType The type of policy to add e.g. m.policy.rule.user. (Use RULE_USER though).
 * @param entity The entity to ban e.g. @foo:example.org
 * @param reason A reason for the rule e.g. 'Wouldn't stop posting spam links'
 * @param template The template to use for the policy rule event.
 * @returns The event id of the newly created policy rule.
 */
async function createPolicyRule(client: MatrixClient, policyRoomId: string, policyType: string, entity: string, reason: string, template = {recommendation: 'm.ban'}) {
    return await client.sendStateEvent(policyRoomId, policyType, `rule:${entity}`, {
        entity,
        reason,
        ...template,
    });
}

describe("Test: Updating the BanList", function () {
    it("Calculates what has changed correctly.", async function () {
        this.timeout(10000);
        const mjolnir = config.RUNTIME.client!
        const moderator = await newTestUser({ name: { contains: "moderator" }});
        const banListId = await mjolnir.createRoom({ invite: [await moderator.getUserId()]});
        const banList = new BanList(banListId, banListId, mjolnir);
        mjolnir.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        assert.equal(banList.allRules.length, 0);

        // Test adding a new rule
        await createPolicyRule(mjolnir, banListId, RULE_USER, '@added:localhost:9999', '');
        let changes: ListRuleChange[] = await banList.updateList();
        assert.equal(changes.length, 1, 'There should only be one change');
        assert.equal(changes[0].changeType, ChangeType.Added);
        assert.equal(changes[0].sender, await mjolnir.getUserId());
        assert.equal(banList.userRules.length, 1);
        assert.equal(banList.allRules.length, 1);

        // Test modifiying a rule
        let originalEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, '@modified:localhost:9999', '');
        await banList.updateList();
        let modifyingEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, '@modified:localhost:9999', 'modified reason');
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Modified);
        assert.equal(changes[0].previousState['event_id'], originalEventId, 'There should be a previous state event for a modified rule');
        assert.equal(changes[0].event['event_id'], modifyingEventId);
        let modifyingAgainEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, '@modified:localhost:9999', 'modified again');
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Modified);
        assert.equal(changes[0].previousState['event_id'], modifyingEventId, 'There should be a previous state event for a modified rule');
        assert.equal(changes[0].event['event_id'], modifyingAgainEventId);
        assert.equal(banList.userRules.length, 2, 'There should be two rules, one for @modified:localhost:9999 and one for @added:localhost:9999');

        // Test redacting a rule
        const redactThis = await createPolicyRule(mjolnir, banListId, RULE_USER, '@redacted:localhost:9999', '');
        await banList.updateList();
        assert.equal(banList.userRules.filter(r => r.entity === '@redacted:localhost:9999').length, 1);
        await mjolnir.redactEvent(banListId, redactThis);
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Removed);
        assert.equal(changes[0].event['event_id'], redactThis, 'Should show the new version of the event with redacted content');
        assert.equal(Object.keys(changes[0].event['content']).length, 0, 'Should show the new version of the event with redacted content');
        assert.notEqual(Object.keys(changes[0].previousState['content']), 0, 'Should have a copy of the unredacted state');
        assert.notEqual(changes[0].rule, undefined, 'The previous rule should be present');
        assert.equal(banList.userRules.filter(r => r.entity === '@redacted:localhost:9999').length, 0, 'The rule should be removed.');

        // Test soft redaction of a rule
        const softRedactedEntity = '@softredacted:localhost:9999'
        await createPolicyRule(mjolnir, banListId, RULE_USER, softRedactedEntity, '');
        await banList.updateList();
        assert.equal(banList.userRules.filter(r => r.entity === softRedactedEntity).length, 1);
        await mjolnir.sendStateEvent(banListId, RULE_USER, `rule:${softRedactedEntity}`, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Removed);
        assert.equal(Object.keys(changes[0].event['content']).length, 0, 'Should show the new version of the event with redacted content');
        assert.notEqual(Object.keys(changes[0].previousState['content']), 0, 'Should have a copy of the unredacted state');
        assert.notEqual(changes[0].rule, undefined, 'The previous rule should be present');
        assert.equal(banList.userRules.filter(r => r.entity === softRedactedEntity).length, 0, 'The rule should have been removed');

        // Now test a double soft redaction just to make sure stuff doesn't explode
        await mjolnir.sendStateEvent(banListId, RULE_USER, `rule:${softRedactedEntity}`, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 0, "It shouldn't detect a double soft redaction as a change, it should be seen as adding an invalid rule.");
        assert.equal(banList.userRules.filter(r => r.entity === softRedactedEntity).length, 0, 'The rule should have been removed');

        // Test that different (old) rule types will be modelled as the latest event type.
        originalEventId = await createPolicyRule(mjolnir, banListId, 'org.matrix.mjolnir.rule.user', '@old:localhost:9999', '');
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Added);
        assert.equal(banList.userRules.filter(r => r.entity === '@old:localhost:9999').length, 1);
        modifyingEventId = await createPolicyRule(mjolnir, banListId, 'm.room.rule.user', '@old:localhost:9999', 'modified reason');
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Modified);
        assert.equal(changes[0].event['event_id'], modifyingEventId);
        assert.equal(changes[0].previousState['event_id'], originalEventId, 'There should be a previous state event for a modified rule');
        assert.equal(banList.userRules.filter(r => r.entity === '@old:localhost:9999').length, 1);
        modifyingAgainEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, '@old:localhost:9999', 'changes again');
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Modified);
        assert.equal(changes[0].event['event_id'], modifyingAgainEventId);
        assert.equal(changes[0].previousState['event_id'], modifyingEventId, 'There should be a previous state event for a modified rule');
        assert.equal(banList.userRules.filter(r => r.entity === '@old:localhost:9999').length, 1);
    })
    it("Will remove rules with old types when they are 'soft redacted' with a different but more recent event type.", async function () {
        this.timeout(3000);
        const mjolnir = config.RUNTIME.client!
        const moderator = await newTestUser({ name: { contains: "moderator" }});
        const banListId = await mjolnir.createRoom({ invite: [await moderator.getUserId()]});
        const banList = new BanList(banListId, banListId, mjolnir);
        mjolnir.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        const entity = '@old:localhost:9999';
        let originalEventId = await createPolicyRule(mjolnir, banListId, 'm.room.rule.user', entity, '');
        let changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Added);
        assert.equal(banList.userRules.filter(rule => rule.entity === entity).length, 1, 'There should be a rule stored that we just added...')
        let softRedactingEventId = await mjolnir.sendStateEvent(banListId, RULE_USER, `rule:${entity}`, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Removed);
        assert.equal(changes[0].event['event_id'], softRedactingEventId);
        assert.equal(changes[0].previousState['event_id'], originalEventId, 'There should be a previous state event for a modified rule');
        assert.equal(banList.userRules.filter(rule => rule.entity === entity).length, 0, 'The rule should no longer be stored.');
    })
    it("A rule of the most recent type won't be deleted when an old rule is deleted for the same entity.", async function () {
        this.timeout(3000);
        const mjolnir = config.RUNTIME.client!
        const moderator = await newTestUser({ name: { contains: "moderator" }});
        const banListId = await mjolnir.createRoom({ invite: [await moderator.getUserId()]});
        const banList = new BanList(banListId, banListId, mjolnir);
        mjolnir.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        const entity = '@old:localhost:9999';
        let originalEventId = await createPolicyRule(mjolnir, banListId, 'm.room.rule.user', entity, '');
        let changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Added);
        assert.equal(banList.userRules.filter(rule => rule.entity === entity).length, 1, 'There should be a rule stored that we just added...')
        let updatedEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, entity, '');
        changes = await banList.updateList();
        // If in the future you change this and it fails, it's really subjective whether this constitutes a modification, since the only thing that has changed
        // is the rule type. The actual content is identical.
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Modified);
        assert.equal(changes[0].event['event_id'], updatedEventId);
        assert.equal(changes[0].previousState['event_id'], originalEventId, 'There should be a previous state event for a modified rule');
        assert.equal(banList.userRules.filter(rule => rule.entity === entity).length, 1, 'Only the latest version of the rule gets returned.');

        // Now we delete the old version of the rule without consequence.
        await mjolnir.sendStateEvent(banListId, 'm.room.rule.user', `rule:${entity}`, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 0);
        assert.equal(banList.userRules.filter(rule => rule.entity === entity).length, 1, 'The rule should still be active.');

        // And we can still delete the new version of the rule.
        let softRedactingEventId = await mjolnir.sendStateEvent(banListId, RULE_USER, `rule:${entity}`, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Removed);
        assert.equal(changes[0].event['event_id'], softRedactingEventId);
        assert.equal(changes[0].previousState['event_id'], updatedEventId, 'There should be a previous state event for a modified rule');
        assert.equal(banList.userRules.filter(rule => rule.entity === entity).length, 0, 'The rule should no longer be stored.');
    })
    it('Test: BanList Supports all entity types.', async function () {
        const mjolnir = config.RUNTIME.client!
        const banListId = await mjolnir.createRoom();
        const banList = new BanList(banListId, banListId, mjolnir);
        for (let i = 0; i < ALL_RULE_TYPES.length; i++) {
            await createPolicyRule(mjolnir, banListId, ALL_RULE_TYPES[i], `*${i}*`, '');
        }
        let changes: ListRuleChange[] = await banList.updateList();
        assert.equal(changes.length, ALL_RULE_TYPES.length);
        assert.equal(banList.allRules.length, ALL_RULE_TYPES.length);
    })
});

describe('Test: We do not respond to recommendations other than m.ban in the banlist', function () {
    it('Will not respond to a rule that has a different recommendation to m.ban (or the unstable equivalent).', async function () {
        const mjolnir = config.RUNTIME.client!
        const banListId = await mjolnir.createRoom();
        const banList = new BanList(banListId, banListId, mjolnir);
        await createPolicyRule(mjolnir, banListId, RULE_SERVER, 'exmaple.org', '', {recommendation: 'something that is not m.ban'});
        let changes: ListRuleChange[] = await banList.updateList();
        assert.equal(changes.length, 1, 'There should only be one change');
        assert.equal(changes[0].changeType, ChangeType.Added);
        assert.equal(changes[0].sender, await mjolnir.getUserId());
        // We really don't want things that aren't m.ban to end up being accessible in these APIs.
        assert.equal(banList.serverRules.length, 0);
        assert.equal(banList.allRules.length, 0);
    })
})

describe('Test: We will not be able to ban ourselves via ACL.', function () {
    it('We do not ban ourselves when we put ourselves into the policy list.', async function () {
        const mjolnir = config.RUNTIME.client!
        const serverName = new UserID(await mjolnir.getUserId()).domain;
        const banListId = await mjolnir.createRoom();
        const banList = new BanList(banListId, banListId, mjolnir);
        await createPolicyRule(mjolnir, banListId, RULE_SERVER, serverName, '');
        await createPolicyRule(mjolnir, banListId, RULE_SERVER, 'evil.com', '');
        await createPolicyRule(mjolnir, banListId, RULE_SERVER, '*', '');
        // We should still intern the matching rules rule.
        let changes: ListRuleChange[] = await banList.updateList();
        assert.equal(banList.serverRules.length, 3);
        // But when we construct an ACL, we should be safe.
        const acl = new ServerAcl(serverName)
        changes.forEach(change => acl.denyServer(change.rule.entity));
        assert.equal(acl.safeAclContent().deny.length, 1);
        assert.equal(acl.literalAclContent().deny.length, 3);
    })
})


describe('Test: ACL updates will batch when rules are added in succession.', function () {
    it('Will batch ACL updates if we spam rules into a BanList', async function () {
        this.timeout(180000)
        const mjolnir = config.RUNTIME.client!
        const serverName: string = new UserID(await mjolnir.getUserId()).domain
        const moderator = await newTestUser({ name: { contains: "moderator" }});
        moderator.joinRoom(this.mjolnir.managementRoomId);
        const mjolnirId = await mjolnir.getUserId();

        // Setup some protected rooms so we can check their ACL state later.
        const protectedRooms: string[] = [];
        for (let i = 0; i < 10; i++) {
            const room = await moderator.createRoom({ invite: [mjolnirId]});
            await mjolnir.joinRoom(room);
            await moderator.setUserPowerLevel(mjolnirId, room, 100);
            await this.mjolnir!.addProtectedRoom(room);
            protectedRooms.push(room);
        }

        // If a previous test hasn't cleaned up properly, these rooms will be populated by bogus ACLs at this point.
        await this.mjolnir!.syncLists();
        await Promise.all(protectedRooms.map(async room => {
            // We're going to need timeline pagination I'm afraid.
            const roomAcl = await mjolnir.getRoomStateEvent(room, "m.room.server_acl", "");
            assert.equal(roomAcl?.deny?.length ?? 0, 0, 'There should be no entries in the deny ACL.');
        }));

        // Flood the watched list with banned servers, which should prompt Mjolnir to update server ACL in protected rooms.
        const banListId = await moderator.createRoom({ invite: [mjolnirId] });
        mjolnir.joinRoom(banListId);
        this.mjolnir!.watchList(Permalinks.forRoom(banListId));
        const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*");
        for (let i = 0; i < 200; i++) {
            const badServer = `${i}.evil.com`;
            acl.denyServer(badServer);
            await createPolicyRule(moderator, banListId, RULE_SERVER, badServer, `Rule #${i}`);
            // Give them a bit of a spread over time.
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // We do this because it should force us to wait until all the ACL events have been applied.
        // Even if that does mean the last few events will not go through batching...
        await this.mjolnir!.syncLists();

        // Check each of the protected rooms for ACL events and make sure they were batched and are correct.
        await Promise.all(protectedRooms.map(async room => {
            const roomAcl = await mjolnir.getRoomStateEvent(room, "m.room.server_acl", "");
            if (!acl.matches(roomAcl)) {
                assert.fail(`Room ${room} doesn't have the correct ACL: ${JSON.stringify(roomAcl, null, 2)}`)
            }
            let aclEventCount = 0;
            await getMessagesByUserIn(mjolnir, mjolnirId, room, 100, events => {
                events.forEach(event => event.type === 'm.room.server_acl' ? aclEventCount += 1 : null);
            });
            LogService.debug('BanListTest', `aclEventCount: ${aclEventCount}`);
            // If there's less than two then it means the ACL was updated by this test calling `this.mjolnir!.syncLists()`
            // and not the listener that detects changes to ban lists (that we want to test!).
            // It used to be 10, but it was too low, 30 seems better for CI.
            assert.equal(aclEventCount < 30 && aclEventCount > 2, true, 'We should have sent less than 30 ACL events to each room because they should be batched')
        }));
    })
})

describe('Test: unbaning entities via the BanList.', function () {
    afterEach(function() { this.moderator?.stop(); });
    it('Will remove rules that have legacy types', async function () {
        this.timeout(20000)
        const mjolnir = config.RUNTIME.client!
        const serverName: string = new UserID(await mjolnir.getUserId()).domain
        const moderator = await newTestUser({ name: { contains: "moderator" }});
        this.moderator = moderator;
        moderator.joinRoom(this.mjolnir.managementRoomId);
        const mjolnirId = await mjolnir.getUserId();

        // We'll make 1 protected room to test ACLs in.
        const protectedRoom = await moderator.createRoom({ invite: [mjolnirId]});
        await mjolnir.joinRoom(protectedRoom);
        await moderator.setUserPowerLevel(mjolnirId, protectedRoom, 100);
        await this.mjolnir!.addProtectedRoom(protectedRoom);

        // If a previous test hasn't cleaned up properly, these rooms will be populated by bogus ACLs at this point.
        await this.mjolnir!.syncLists();
        const roomAcl = await mjolnir.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        assert.equal(roomAcl?.deny?.length ?? 0, 0, 'There should be no entries in the deny ACL.');

        // Create some legacy rules on a BanList.
        const banListId = await moderator.createRoom({ invite: [mjolnirId] });
        await moderator.setUserPowerLevel(await mjolnir.getUserId(), banListId, 100);
        await moderator.sendStateEvent(banListId, 'org.matrix.mjolnir.shortcode', '', { shortcode: "unban-test"});
        await mjolnir.joinRoom(banListId);
        this.mjolnir!.watchList(Permalinks.forRoom(banListId));
        // we use this to compare changes.
        const banList = new BanList(banListId, banListId, moderator);
        // we need two because we need to test the case where an entity has all rule types in the list
        // and another one that only has one (so that we would hit 404 while looking up state)
        const olderBadServer = "old.evil.com"
        const newerBadServer = "new.evil.com"
        await Promise.all(SERVER_RULE_TYPES.map(type => createPolicyRule(moderator, banListId, type, olderBadServer, 'gregg rulz ok')));
        await createPolicyRule(moderator, banListId, RULE_SERVER, newerBadServer, 'this is bad sort it out.');
        // Wait for the ACL event to be applied to our protected room.
        await this.mjolnir!.syncLists();

        await banList.updateList();
        // rules are normalized, that's why there should only be 2.
        assert.equal(banList.allRules.length, 2);

        // Check that we have setup our test properly and therefore evil.com is banned.
        const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*").denyServer(olderBadServer).denyServer(newerBadServer);
        const protectedAcl = await mjolnir.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        if (!acl.matches(protectedAcl)) {
            assert.fail(`Room ${protectedRoom} doesn't have the correct ACL: ${JSON.stringify(roomAcl, null, 2)}`);
        }

        // Now unban the servers, we will go via the unban command for completeness sake.
        try {
            await moderator.start();
            for (const server of [olderBadServer, newerBadServer]) {
                await getFirstReaction(moderator, this.mjolnir.managementRoomId, '✅', async () => {
                    return await moderator.sendMessage(this.mjolnir.managementRoomId, {msgtype: 'm.text', body: `!mjolnir unban unban-test server ${server}`});
                });
            }
        } finally {
            moderator.stop();
        }

        // Wait for mjolnir to sync protected rooms to update ACL.
        await this.mjolnir!.syncLists();
        // Confirm that the server is unbanned.
        await banList.updateList();
        assert.equal(banList.allRules.length, 0);
        const aclAfter = await mjolnir.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        assert.equal(aclAfter.deny.length, 0, 'Should be no servers denied anymore');
    })
})

describe.only('Test: should apply bans to the most recently active rooms first', function () {
    it('Applies bans to the most recently active rooms first', async function () {
        this.timeout(6000000000)
        const mjolnir = config.RUNTIME.client!
        const serverName: string = new UserID(await mjolnir.getUserId()).domain
        const moderator = await newTestUser({ name: { contains: "moderator" }});
        moderator.joinRoom(this.mjolnir.managementRoomId);
        const mjolnirId = await mjolnir.getUserId();

        // Setup some protected rooms so we can check their ACL state later.
        const protectedRooms: string[] = [];
        for (let i = 0; i < 10; i++) {
            const room = await moderator.createRoom({ invite: [mjolnirId]});
            await mjolnir.joinRoom(room);
            await moderator.setUserPowerLevel(mjolnirId, room, 100);
            await this.mjolnir!.addProtectedRoom(room);
            protectedRooms.push(room);
        }

        // If a previous test hasn't cleaned up properly, these rooms will be populated by bogus ACLs at this point.
        await this.mjolnir!.syncLists();
        await Promise.all(protectedRooms.map(async room => {
            const roomAcl = await mjolnir.getRoomStateEvent(room, "m.room.server_acl", "").catch(e => e.statusCode === 404 ? {deny: []} : Promise.reject(e));
            assert.equal(roomAcl?.deny?.length ?? 0, 0, 'There should be no entries in the deny ACL.');
        }));

        // Flood the watched list with banned servers, which should prompt Mjolnir to update server ACL in protected rooms.
        const banListId = await moderator.createRoom({ invite: [mjolnirId] });
        mjolnir.joinRoom(banListId);
        this.mjolnir!.watchList(Permalinks.forRoom(banListId));

        await this.mjolnir!.syncLists();

        // shuffle protected rooms https://stackoverflow.com/a/12646864, we do this so we can create activity "randomly" in them.
        for (let i = protectedRooms.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [protectedRooms[i], protectedRooms[j]] = [protectedRooms[j], protectedRooms[i]];
        }
        // create some activity in the same order.
        for (const roomId of protectedRooms.slice().reverse()) {
            await mjolnir.sendMessage(roomId, {body: `activity`, msgtype: 'm.text'});
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // check the rooms are in the expected order
        for (let i = 0; i < protectedRooms.length; i++) {
            assert.equal(this.mjolnir!.protectedRoomsByActivity()[i], protectedRooms[i]);
        }

        const badServer = `evil.com`;
        // just ban one server
        const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*").denyServer(badServer);
        await createPolicyRule(moderator, banListId, RULE_SERVER, badServer, `Rule ${badServer}`);

        // Wait until all the ACL events have been applied.
        await this.mjolnir!.syncLists();

        for (let i = 0; i < protectedRooms.length; i++) {
            assert.equal(this.mjolnir!.protectedRoomsByActivity()[i], protectedRooms.at(-i - 1));
        }

        // Check that the most recently active rooms got the ACL update first.
        let last_event_ts = 0;
        for (const roomId of protectedRooms) {
            let roomAclEvent: null|any;
            // Can't be the best way to get the whole event, but ok.
            await getMessagesByUserIn(mjolnir, mjolnirId, roomId, 1, events => roomAclEvent = events[0]);
            const roomAcl = roomAclEvent!.content;
            if (!acl.matches(roomAcl)) {
                assert.fail(`Room ${roomId} doesn't have the correct ACL: ${JSON.stringify(roomAcl, null, 2)}`)
            }
            assert.equal(roomAclEvent.origin_server_ts > last_event_ts, true, `This room was more recently active so should have the more recent timestamp`);
            last_event_ts = roomAclEvent.origin_server_ts;
        }
    })
})
