import { strict as assert } from "assert";

import config from "../../src/config";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";
import { newTestUser } from "./clientHelper";

/**
 * Test the ability to turn abuse reports into room messages.
 */

describe("Test: Reporting abuse", async () => {
    it('Mjölnir intercepts abuse reports', async function() {
        this.timeout(10000);

        // Listen for any notices that show up.
        let notices = [];
        matrixClient().on("room.event", (roomId, event) => {
            if (roomId = config.managementRoom) {
                notices.push(event);
            }
        });

        // Create a few users and a room.
        let goodUser = await newTestUser(false, "reporting-abuse-good-user");
        let badUser = await newTestUser(false, "reporting-abuse-bad-user");
        let goodUserId = await goodUser.getUserId();
        let badUserId = await badUser.getUserId();

        let roomId = await goodUser.createRoom({ invite: [await badUser.getUserId()] });
        await goodUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);

        console.log("Test: Reporting abuse - send messages");
        // Exchange a few messages.
        let goodText = `GOOD: ${Math.random()}`; // Will NOT be reported.
        let badText = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let badText2 = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let goodEventId = await goodUser.sendText(roomId, goodText);
        let badEventId = await badUser.sendText(roomId, badText);
        let badEventId2 = await badUser.sendText(roomId, badText2);
        let badEvent2Comment = `COMMENT: ${Math.random()}`;

        console.log("Test: Reporting abuse - send reports");
        let reportsToFind = []

        // Time to report, first without a comment, then with one.
        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId)}`);
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId,
                text: badText,
                comment: null,
            });
        } catch (e) {
            console.error("Could not send first report", e.body || e);
            throw e;
        }

        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId2)}`, "", {
                reason: badEvent2Comment
            });
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId2,
                text: badText2,
                comment: badEvent2Comment,
            });
        } catch (e) {
            console.error("Could not send second report", e.body || e);
            throw e;
        }
        // FIXME: Also test with embedded HTML.

        console.log("Test: Reporting abuse - wait");
        await new Promise(resolve => setTimeout(resolve, 1000));
        let found = [];
        const REGEXPS = {
            reporter: /Filed by (?<reporterDisplay>[^ ]*) \((?<reporterId>[^ ]*)\)/,
            accused: /Against (?<accusedDisplay>[^ ]*) \((?<accusedId>[^ ]*)\)/,
            room: /Room (?<roomAliasOrId>[^ ]*)/,
            event: /Event (?<eventId>[^ ]*) Go to event/,
            content: /Content (?<eventContent>.*)/,
            comments: /Comments (?<comments>.*)/
        };
        for (let toFind of reportsToFind) {
            for (let event of notices) {
                if ("content" in event && "body" in event.content) {
                    let body = event.content.body as string;
                    console.debug("Is this a report?", body);
                    let matches = new Map();
                    for (let key of Object.keys(REGEXPS)) {
                        let match = body.match(REGEXPS[key]);
                        if (match) {
                            console.debug("We have a match", key, REGEXPS[key], match.groups);
                        } else {
                            console.debug("Not a match", key, REGEXPS[key]);
                            // Not a report, skipping.
                            matches = null;
                            break;
                        }
                        matches.set(key, match);
                    }
                    if (!matches) {
                        // Not a report, skipping.
                        continue;
                    }

                    if (matches.get("event")!.groups.eventId != toFind.eventId) {
                        // Different event id, skipping.
                        console.debug("Different event id, skipping", matches.get("event")!.groups.eventId, toFind.eventId);
                        continue;
                    }
                    assert.equal(matches.get("reporter")!.groups.reporterId, toFind.reporterId, "The report should specify the correct reporter");
                    assert.equal(matches.get("accused")!.groups.accusedId, toFind.accusedId, "The report should specify the correct accused");
                    assert.ok(toFind.reporterId.includes(matches.get("reporter")!.groups.reporterDisplay), "The report should display the correct reporter");
                    assert.ok(toFind.accusedId.includes(matches.get("accused")!.groups.accusedDisplay), "The report should display the correct reporter");
                    assert.equal(matches.get("content")!.groups.eventContent, toFind.text, "The report should contain the text we inserted in the event");
                    if (toFind.comment) {
                        assert.equal(matches.get("comments")!.groups.comments, toFind.comment, "The report should contain the comment we added");
                    }
                    found.push(toFind);
                    break;
                }
            }
        }
        assert.deepEqual(found, reportsToFind);
    })
});
