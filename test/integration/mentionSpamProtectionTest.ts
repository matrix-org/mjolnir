import {newTestUser} from "./clientHelper";

import {MatrixClient} from "@vector-im/matrix-bot-sdk";
import {getFirstReaction} from "./commands/commandUtils";
import {strict as assert} from "assert";
import { DEFAULT_MAX_MENTIONS } from "../../src/protections/MentionSpam";

describe("Test: Mention spam protection", function () {
    let client: MatrixClient;
    let room: string;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, {name: {contains: "mention-spam-protection"}});
        await client.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        room = await client.createRoom({ invite: [mjolnirId] });
        await client.joinRoom(room);
        await client.joinRoom(this.config.managementRoom);
        await client.setUserPowerLevel(mjolnirId, room, 100);
    })
    this.afterEach(async function () {
        await client.stop();
    })

    function delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    it("does not redact a normal message", async function() {
        await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${room}` });
        await getFirstReaction(client, this.mjolnir.managementRoomId, '✅', async () => {
                return await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: "!mjolnir enable MentionSpam" });
        });
        const testMessage = await client.sendText(room, 'Hello world');

        await delay(500);

        const fetchedEvent = await client.getEvent(room, testMessage);
        assert.equal(Object.keys(fetchedEvent.content).length, 2, "This event should not have been redacted");
    });

    it("does not redact a message with some mentions", async function() {
        await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${room}` });
        await getFirstReaction(client, this.mjolnir.managementRoomId, '✅', async () => {
                return await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: "!mjolnir enable MentionSpam" });
        });
        // Also covers HTML mentions
        const mentionUsers = Array.from({length: DEFAULT_MAX_MENTIONS}, (_, i) => `@user${i}:example.org`);
        const messageWithTextMentions = await client.sendText(room, mentionUsers.join(' '));
        const messageWithHTMLMentions = await client.sendHtmlText(room, 
            mentionUsers.map(u => `<a href=\"https://matrix.to/#/${encodeURIComponent(u)}\">${u}</a>`).join(' '));
        const messageWithMMentions = await client.sendMessage(room, {
            msgtype: 'm.text',
            body: 'Hello world',
            ['m.mentions']: {
                user_ids: mentionUsers
            }
        });

        await delay(500);

        const fetchedTextEvent = await client.getEvent(room, messageWithTextMentions);
        assert.equal(Object.keys(fetchedTextEvent.content).length, 2, "This event should not have been redacted");

        const fetchedHTMLEvent = await client.getEvent(room, messageWithHTMLMentions);
        assert.equal(Object.keys(fetchedHTMLEvent.content).length, 4, "This event should not have been redacted");

        const fetchedMentionsEvent = await client.getEvent(room, messageWithMMentions);
        assert.equal(Object.keys(fetchedMentionsEvent.content).length, 3, "This event should not have been redacted");
    });

    it("does redact a message with too many mentions", async function() {
        await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${room}` });
        await getFirstReaction(client, this.mjolnir.managementRoomId, '✅', async () => {
                return await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: "!mjolnir enable MentionSpam" });
        });
        // Also covers HTML mentions
        const mentionUsers = Array.from({length: DEFAULT_MAX_MENTIONS+1}, (_, i) => `@user${i}:example.org`);
        const mentionDisplaynames = Array.from({length: DEFAULT_MAX_MENTIONS+1}, (_, i) => `Test User ${i}`);

        // Pre-set the displayname cache.
        let protection = this.mjolnir.protectionManager.protections.get('MentionSpam')
        protection.roomDisplaynameCache.set(room, mentionDisplaynames);

        const messageWithTextMentions = await client.sendText(room, mentionUsers.join(' '));
        const messageWithHTMLMentions = await client.sendHtmlText(room, 
            mentionUsers.map(u => `<a href=\"https://matrix.to/#/${encodeURIComponent(u)}\">${u}</a>`).join(' '));
        const messageWithMMentions = await client.sendMessage(room, {
            msgtype: 'm.text',
            body: 'Hello world',
            ['m.mentions']: {
                user_ids: mentionUsers
            }
        });
        const messageWithDisplaynameMentions = await client.sendText(room, mentionDisplaynames.join(' '));

        await delay(500);

        const fetchedTextEvent = await client.getEvent(room, messageWithTextMentions);
        assert.equal(Object.keys(fetchedTextEvent.content).length, 0, "This event should have been redacted");

        const fetchedHTMLEvent = await client.getEvent(room, messageWithHTMLMentions);
        assert.equal(Object.keys(fetchedHTMLEvent.content).length, 0, "This event should have been redacted");

        const fetchedMentionsEvent = await client.getEvent(room, messageWithMMentions);
        assert.equal(Object.keys(fetchedMentionsEvent.content).length, 0, "This event should have been redacted");

        const fetchedDisplaynameEvent = await client.getEvent(room, messageWithDisplaynameMentions);
        assert.equal(Object.keys(fetchedDisplaynameEvent.content).length, 0, "This event should have been redacted");

        // send messages after activating protection, they should be auto-redacted
        const messages = [];
        for (let i = 0; i < 10; i++) {
            let nextMessage = await client.sendText(room, `hello${i}`);
            messages.push(nextMessage)
        }

        messages.forEach(async (eventID) => {
            await client.getEvent(room, eventID);
            assert.equal(Object.keys(fetchedDisplaynameEvent.content).length, 0, "This event should have been redacted");
        })
    });
});