/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import expect from "expect";
import { LogService, RichConsoleLogger } from "@vector-im/matrix-bot-sdk";

import { EventRedactionQueue, RedactUserInRoom } from "../../src/queues/EventRedactionQueue";
import ManagementRoomOutput from "../../src/ManagementRoomOutput";
import { MatrixSendClient } from "../../src/MatrixEmitter";

const ADMIN_REDACT_ENDPOINT = /^\/_synapse\/admin\/v1\/user\/(.*)\/redact$/;
const MESSAGES_ENDPOINT = /^\/_matrix\/client\/v3\/rooms\/(.*)\/messages$/;

interface AdminRedactRequest {
    userId: string;
    rooms: string[];
    limit: number;
}

/**
 * A `MatrixSendClient` that records the requests the redaction code makes of it, so that tests
 * can assert on how many requests were made and what they contained.
 */
class FakeClient {
    /** One entry per `POST /_synapse/admin/v1/user/{userId}/redact`. */
    public readonly adminRedactions: AdminRedactRequest[] = [];
    /** One entry per event redacted individually, i.e. via the non-admin process. */
    public readonly redactedEvents: { roomId: string; eventId: string }[] = [];
    /** Rooms we paginated the timeline of, i.e. the non-admin process looked at. */
    public readonly backfilledRooms: string[] = [];
    /** Messages sent to the management room, e.g. to report a failure. */
    public readonly sentMessages: { roomId: string; content: any }[] = [];

    /**
     * When set, the admin redaction endpoint rejects with this error instead of succeeding,
     * which should send the caller down the non-admin fallback path.
     */
    public adminRedactionError?: Error;
    /** When set, `getRoomMembers` rejects with this error. */
    public getRoomMembersError?: Error;

    /** The events `getMessagesByUserIn` will find in every room. */
    public timeline: any[] = [];

    public async doRequest(method: string, path: string, qs?: any, body?: any): Promise<any> {
        const adminRedact = ADMIN_REDACT_ENDPOINT.exec(path);
        if (adminRedact) {
            if (this.adminRedactionError) {
                throw this.adminRedactionError;
            }
            this.adminRedactions.push({
                userId: decodeURIComponent(adminRedact[1]),
                rooms: body["rooms"],
                limit: body["limit"],
            });
            return { redact_id: `redact-${this.adminRedactions.length}` };
        }

        const messages = MESSAGES_ENDPOINT.exec(path);
        if (messages) {
            this.backfilledRooms.push(decodeURIComponent(messages[1]));
            // No `end` token, so `getMessagesByUserIn` stops after this chunk.
            return { start: "s0", chunk: this.timeline };
        }

        throw new Error(`Unexpected request: ${method} ${path}`);
    }

    public async getRoomMembers(roomId: string): Promise<any[]> {
        if (this.getRoomMembersError) {
            throw this.getRoomMembersError;
        }
        // Every user we ask about is a member of every room, so `filterRooms` keeps them all.
        return [{ stateKey: "@spammer:example.org" }, { stateKey: "@other-spammer:example.org" }];
    }

    public async redactEvent(roomId: string, eventId: string): Promise<void> {
        this.redactedEvents.push({ roomId, eventId });
    }

    public async sendMessage(roomId: string, content: any): Promise<string> {
        this.sentMessages.push({ roomId, content });
        return "$fake";
    }
}

function createFakeClient(): FakeClient {
    return new FakeClient();
}

function asClient(client: FakeClient): MatrixSendClient {
    return client as unknown as MatrixSendClient;
}

function createFakeManagementRoom(): ManagementRoomOutput {
    return {
        managementRoomId: "!management:example.org",
        logMessage: async () => {},
    } as unknown as ManagementRoomOutput;
}

function queueUserInRooms(queue: EventRedactionQueue, userId: string, roomIds: string[], isAdmin: boolean) {
    for (const roomId of roomIds) {
        queue.add(new RedactUserInRoom(userId, roomId, isAdmin, []));
    }
}

describe("EventRedactionQueue", () => {
    // The fallback path logs the error it recovered from, which would otherwise be printed
    // by the test run and read as a failure.
    before(() => {
        LogService.setLogger({
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            trace: () => {},
        });
    });

    after(() => {
        LogService.setLogger(new RichConsoleLogger());
    });

    describe("process, as a server admin", () => {
        it("redacts a user across all of their rooms in a single admin API request", async () => {
            const client = createFakeClient();
            const queue = new EventRedactionQueue();
            const rooms = ["!a:example.org", "!b:example.org", "!c:example.org"];
            queueUserInRooms(queue, "@spammer:example.org", rooms, true);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            expect(errors).toHaveLength(0);
            expect(client.adminRedactions).toHaveLength(1);
            expect(client.adminRedactions[0].userId).toBe("@spammer:example.org");
            expect(client.adminRedactions[0].rooms).toEqual(rooms);
            // The admin API applies its limit per room, so batching must not shrink it.
            expect(client.adminRedactions[0].limit).toBe(1000);
            // The admin API does the redacting for us, so we should not touch events ourselves.
            expect(client.redactedEvents).toHaveLength(0);
        });

        it("issues one request per user rather than one per room", async () => {
            const client = createFakeClient();
            const queue = new EventRedactionQueue();
            queueUserInRooms(queue, "@spammer:example.org", ["!a:example.org", "!b:example.org"], true);
            queueUserInRooms(queue, "@other-spammer:example.org", ["!a:example.org", "!b:example.org"], true);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            expect(errors).toHaveLength(0);
            expect(client.adminRedactions).toHaveLength(2);
            const byUser = new Map(client.adminRedactions.map((r) => [r.userId, r.rooms]));
            expect(byUser.get("@spammer:example.org")).toEqual(["!a:example.org", "!b:example.org"]);
            expect(byUser.get("@other-spammer:example.org")).toEqual(["!a:example.org", "!b:example.org"]);
        });

        it("only processes the given room when limited to one, leaving the rest queued", async () => {
            const client = createFakeClient();
            const queue = new EventRedactionQueue();
            queueUserInRooms(queue, "@spammer:example.org", ["!a:example.org", "!b:example.org"], true);

            const errors = await queue.process(asClient(client), createFakeManagementRoom(), "!a:example.org");

            expect(errors).toHaveLength(0);
            expect(client.adminRedactions).toHaveLength(1);
            expect(client.adminRedactions[0].rooms).toEqual(["!a:example.org"]);

            // The other room is still queued and gets picked up by the next full pass.
            await queue.process(asClient(client), createFakeManagementRoom());
            expect(client.adminRedactions).toHaveLength(2);
            expect(client.adminRedactions[1].rooms).toEqual(["!b:example.org"]);
        });

        it("does not use the admin API for globs, which it does not support", async () => {
            const client = createFakeClient();
            client.timeline = [{ event_id: "$one", sender: "@spammer:example.org" }];
            const queue = new EventRedactionQueue();
            queueUserInRooms(queue, "@spam*:example.org", ["!a:example.org", "!b:example.org"], true);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            expect(errors).toHaveLength(0);
            expect(client.adminRedactions).toHaveLength(0);
            expect(client.backfilledRooms).toEqual(["!a:example.org", "!b:example.org"]);
        });

        it("falls back to redacting each room by hand when the admin API fails", async () => {
            const client = createFakeClient();
            client.adminRedactionError = new Error("not an admin");
            client.timeline = [{ event_id: "$one", sender: "@spammer:example.org" }];
            const queue = new EventRedactionQueue();
            const rooms = ["!a:example.org", "!b:example.org", "!c:example.org"];
            queueUserInRooms(queue, "@spammer:example.org", rooms, true);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            // The fallback handles the failure, so it isn't reported as a room update error.
            expect(errors).toHaveLength(0);
            // Every batched room must be covered by the fallback, not just the first.
            expect(client.redactedEvents).toEqual(rooms.map((roomId) => ({ roomId, eventId: "$one" })));
            expect(client.sentMessages).toHaveLength(1);
            expect(client.sentMessages[0].content["body"]).toContain("falling back");
        });

        it("reports an error against every room in a batch that could not be processed", async () => {
            const client = createFakeClient();
            client.getRoomMembersError = new Error("no peeking");
            const queue = new EventRedactionQueue();
            const rooms = ["!a:example.org", "!b:example.org"];
            queueUserInRooms(queue, "@spammer:example.org", rooms, true);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            expect(errors.map((e) => e.roomId)).toEqual(rooms);
            for (const error of errors) {
                expect(error.errorMessage).toBe("no peeking");
            }
        });
    });

    describe("process, without admin", () => {
        it("redacts each room individually", async () => {
            const client = createFakeClient();
            client.timeline = [
                { event_id: "$one", sender: "@spammer:example.org" },
                { event_id: "$two", sender: "@spammer:example.org" },
            ];
            const queue = new EventRedactionQueue();
            queueUserInRooms(queue, "@spammer:example.org", ["!a:example.org", "!b:example.org"], false);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            expect(errors).toHaveLength(0);
            expect(client.adminRedactions).toHaveLength(0);
            expect(client.backfilledRooms).toEqual(["!a:example.org", "!b:example.org"]);
            expect(client.redactedEvents).toEqual([
                { roomId: "!a:example.org", eventId: "$one" },
                { roomId: "!a:example.org", eventId: "$two" },
                { roomId: "!b:example.org", eventId: "$one" },
                { roomId: "!b:example.org", eventId: "$two" },
            ]);
        });

        it("processes admin and non-admin redactions in the same pass", async () => {
            const client = createFakeClient();
            client.timeline = [{ event_id: "$one", sender: "@other-spammer:example.org" }];
            const queue = new EventRedactionQueue();
            queueUserInRooms(queue, "@spammer:example.org", ["!a:example.org", "!b:example.org"], true);
            queueUserInRooms(queue, "@other-spammer:example.org", ["!a:example.org"], false);

            const errors = await queue.process(asClient(client), createFakeManagementRoom());

            expect(errors).toHaveLength(0);
            expect(client.adminRedactions).toHaveLength(1);
            expect(client.adminRedactions[0].rooms).toEqual(["!a:example.org", "!b:example.org"]);
            expect(client.redactedEvents).toEqual([{ roomId: "!a:example.org", eventId: "$one" }]);
        });
    });

    describe("add", () => {
        it("does not queue the same user and room twice", () => {
            const queue = new EventRedactionQueue();
            expect(queue.add(new RedactUserInRoom("@spammer:example.org", "!a:example.org", true, []))).toBe(true);
            expect(queue.add(new RedactUserInRoom("@spammer:example.org", "!a:example.org", true, []))).toBe(false);
            expect(queue.add(new RedactUserInRoom("@spammer:example.org", "!b:example.org", true, []))).toBe(true);
        });
    });
});
