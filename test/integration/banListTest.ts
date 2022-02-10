import { strict as assert } from "assert";

import config from "../../src/config";
import { newTestUser } from "./clientHelper";
import { MatrixClient, UserID } from "matrix-bot-sdk";
import  BanList, { ALL_RULE_TYPES, ChangeType, ListRuleChange, RULE_SERVER, RULE_USER } from "../../src/models/BanList";
import { ServerAcl, ServerAclContent } from "../../src/models/ServerAcl";

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
