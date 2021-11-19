import { strict as assert } from "assert";

import config from "../../src/config";
import { newTestUser } from "./clientHelper";
import { MatrixClient } from "matrix-bot-sdk";
import  BanList, { ChangeType, ListRuleChange, RULE_USER } from "../../src/models/BanList";

/**
 * Create a policy rule in a policy room.
 * @param client A matrix client that is logged in
 * @param policyRoomId The room id to add the policy to.
 * @param policyType The type of policy to add e.g. m.policy.rule.user. (Use RULE_USER though).
 * @param entity The entity to ban e.g. @foo:example.org
 * @param reason A reason for the rule e.g. 'Wouldn't stop posting spam links'
 * @returns The event id of the newly created policy rule.
 */
async function createPolicyRule(client: MatrixClient, policyRoomId: string, policyType: string, entity: string, reason: string) {
    return await client.sendStateEvent(policyRoomId, policyType, `rule:${entity}`, {
        entity,
        reason,
        recommendation: 'm.ban'
    });
}

describe("Test: Updating the BanList", function () {
    it("Calculates what has changed correctly.", async function () {
        this.timeout(10000);
        const mjolnir = config.RUNTIME.client!
        const moderator = await newTestUser(false, "moderator");
        const banListId = await mjolnir.createRoom({ invite: [await moderator.getUserId()]});
        const banList = new BanList(banListId, banListId, mjolnir);
        mjolnir.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        // Test adding a new rule
        await createPolicyRule(mjolnir, banListId, RULE_USER, '@added:localhost:9999', '');
        let changes: ListRuleChange[] = await banList.updateList();
        assert.equal(changes.length, 1, 'There should only be one change');
        assert.equal(changes[0].changeType, ChangeType.Added);
        assert.equal(changes[0].sender, await mjolnir.getUserId());

        // Test modifiying a rule
        let originalEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, '@modified:localhost:9999', '');
        await banList.updateList();
        let nextEventId = await createPolicyRule(mjolnir, banListId, RULE_USER, '@modified:localhost:9999', 'modified reason');
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Modified);
        assert.equal(changes[0].previousState['event_id'], originalEventId, 'There should be a previous state event for a modified rule');
        assert.equal(changes[0].event['event_id'], nextEventId);

        // Test redacting a rule
        const redactThis = await createPolicyRule(mjolnir, banListId, RULE_USER, '@redacted:localhost:9999', '');
        await banList.updateList();
        await mjolnir.redactEvent(banListId, redactThis);
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Removed);
        assert.equal(changes[0].event['event_id'], redactThis, 'Should show the new version of the event with redacted content');
        assert.equal(Object.keys(changes[0].event['content']).length, 0, 'Should show the new version of the event with redacted content');
        assert.notEqual(Object.keys(changes[0].previousState['content']), 0, 'Should have a copy of the unredacted state');
        assert.notEqual(changes[0].rule, undefined, 'The previous rule should be present');

        // Test soft redaction of a rule
        const softRedactedEntity = '@softredacted:localhost:9999'
        await createPolicyRule(mjolnir, banListId, RULE_USER, softRedactedEntity, '');
        await banList.updateList();
        await mjolnir.sendStateEvent(banListId, RULE_USER, softRedactedEntity, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 1);
        assert.equal(changes[0].changeType, ChangeType.Removed);
        assert.equal(Object.keys(changes[0].event['content']).length, 0, 'Should show the new version of the event with redacted content');
        assert.notEqual(Object.keys(changes[0].previousState['content']), 0, 'Should have a copy of the unredacted state');
        assert.notEqual(changes[0].rule, undefined, 'The previous rule should be present');

        // Now test a double soft redaction just to make sure stuff doesn't explode
        await mjolnir.sendStateEvent(banListId, RULE_USER, softRedactedEntity, {});
        changes = await banList.updateList();
        assert.equal(changes.length, 0, "It shouldn't detect a double soft redaction as a change, it should be seen as adding an invalid rule.");
    })
});
