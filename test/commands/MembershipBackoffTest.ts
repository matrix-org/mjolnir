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

import { getJoinedRoomMembersWithBackoff, getJoinedRoomsWithBackoff } from "../../src/utils";
import { MatrixSendClient } from "../../src/MatrixEmitter";

/** The outcome of a single membership lookup, scripted by the test. */
type Outcome = { resolve: string[] } | { reject: Error };

/**
 * A `MatrixSendClient` whose membership lookups return whatever the test scripted for them,
 * recording each call so tests can assert on how many attempts were made.
 */
class FakeClient {
    /** One entry per membership lookup, in the order they were made. */
    public readonly calls: { method: "getJoinedRooms" | "getJoinedRoomMembers"; roomId?: string }[] = [];

    /** The outcomes not yet consumed. */
    private readonly outcomes: Outcome[];

    /**
     * @param outcomes The outcome of each successive lookup. Consumed in order, so a test that
     * scripts fewer outcomes than the code makes calls fails rather than looping.
     */
    constructor(outcomes: Outcome[]) {
        this.outcomes = outcomes;
    }

    private nextOutcome(): string[] {
        const outcome = this.outcomes.shift();
        if (!outcome) {
            throw new Error("Unexpected membership lookup: the test scripted no outcome for it");
        }
        if ("reject" in outcome) {
            throw outcome.reject;
        }
        return outcome.resolve;
    }

    public async getJoinedRooms(): Promise<string[]> {
        this.calls.push({ method: "getJoinedRooms" });
        return this.nextOutcome();
    }

    public async getJoinedRoomMembers(roomId: string): Promise<string[]> {
        this.calls.push({ method: "getJoinedRoomMembers", roomId });
        return this.nextOutcome();
    }
}

function asClient(client: FakeClient): MatrixSendClient {
    return client as unknown as MatrixSendClient;
}

/** An error shaped like the ones `matrix-bot-sdk` throws when a request fails. */
function requestError(statusCode: number, errcode: string): Error {
    const error: any = new Error(`Request failed with status ${statusCode}`);
    error.statusCode = statusCode;
    error.body = { errcode };
    return error;
}

describe("membership lookups with backoff", () => {
    // The retry path logs the error it recovered from, which would otherwise be printed by the
    // test run and read as a failure.
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

    describe("getJoinedRoomsWithBackoff", () => {
        it("returns the joined rooms without retrying when the first attempt succeeds", async () => {
            const client = new FakeClient([{ resolve: ["!protected:example.org", "!management:example.org"] }]);

            const rooms = await getJoinedRoomsWithBackoff(asClient(client));

            expect(rooms).toEqual(["!protected:example.org", "!management:example.org"]);
            expect(client.calls).toEqual([{ method: "getJoinedRooms" }]);
        });

        it("gives up immediately on an error that isn't a 503", async () => {
            const error = requestError(403, "M_FORBIDDEN");
            const client = new FakeClient([{ reject: error }]);

            await expect(getJoinedRoomsWithBackoff(asClient(client))).rejects.toThrow(error);

            expect(client.calls).toEqual([{ method: "getJoinedRooms" }]);
        });
    });

    describe("getJoinedRoomMembersWithBackoff", () => {
        it("passes the room ID through and returns its members", async () => {
            const client = new FakeClient([{ resolve: ["@mod:example.org", "@admin:example.org"] }]);

            const members = await getJoinedRoomMembersWithBackoff(asClient(client), "!management:example.org");

            expect(members).toEqual(["@mod:example.org", "@admin:example.org"]);
            expect(client.calls).toEqual([{ method: "getJoinedRoomMembers", roomId: "!management:example.org" }]);
        });

        it("retries after a 503 and returns the members from the second attempt", async function () {
            // The first backoff waits a second, which is longer than mocha's default timeout.
            this.timeout(5000);
            const client = new FakeClient([
                { reject: requestError(503, "M_UNKNOWN") },
                { resolve: ["@mod:example.org"] },
            ]);
            const startedAt = Date.now();

            const members = await getJoinedRoomMembersWithBackoff(asClient(client), "!management:example.org");

            expect(members).toEqual(["@mod:example.org"]);
            expect(client.calls).toEqual([
                { method: "getJoinedRoomMembers", roomId: "!management:example.org" },
                { method: "getJoinedRoomMembers", roomId: "!management:example.org" },
            ]);
            // The retry backs off rather than spinning.
            expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
        });

        it("gives up after a bounded number of attempts when every attempt 503s", async function () {
            // Sits through the whole backoff: 1 + 2 + 4 + 8 seconds between the five attempts.
            this.timeout(30000);
            // Distinct instances so the assertion below can tell which attempt's error propagated.
            const errors = Array.from({ length: 5 }, () => requestError(503, "M_UNKNOWN"));
            const client = new FakeClient(errors.map((reject) => ({ reject })));

            // A loop that failed to terminate would run out of scripted outcomes and reject with
            // FakeClient's "unexpected lookup" error rather than the last 503, so this fails
            // instead of hanging.
            await expect(getJoinedRoomMembersWithBackoff(asClient(client), "!management:example.org")).rejects.toBe(
                errors[errors.length - 1],
            );

            expect(client.calls).toHaveLength(errors.length);
        });
    });
});
