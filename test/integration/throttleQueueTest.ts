import { strict as assert } from "assert";

import { UserID } from "matrix-bot-sdk";
import { ThrottlingQueue } from "../../src/queues/ThrottlingQueue";

describe("Test: ThrottlingQueue", function() {
    it("Tasks enqueued with `push()` are executed exactly once and in the right order", async function() {
        this.timeout(20000);

        const queue = new ThrottlingQueue(this.mjolnir, 10);
        let state = new Map();
        let promises: Promise<void>[] = [];
        for (let counter = 0; counter < 10; ++counter) {
            const i = counter;
            const promise = queue.push(async () => {
                if (state.get(i)) {
                    throw new Error(`We shouldn't have set state[${i}] yet`);
                }
                state.set(i, true);
                for (let j = 0; j < i; ++j) {
                    if (!state.get(j)) {
                        throw new Error(`We should have set state[${j}] already`);
                    }
                }
            });
            promises.push(promise);
        }
        await Promise.all(promises);
        for (let i = 0; i < 10; ++i) {
            if (!state.get(i)) {
                throw new Error(`This is the end of the test, we should have set state[${i}]`);
            }
        }

        // Give code a little bit more time to trip itself, in case `promises` are accidentally
        // resolved too early.
        await new Promise(resolve => setTimeout(resolve, 1000));

        queue.dispose();
    });

    it("Tasks enqueued with `push()` are executed exactly once and in the right order, even if we call `block()` at some point", async function() {
        this.timeout(20000);
        const queue = new ThrottlingQueue(this.mjolnir, 10);
        let state = new Map();
        let promises: Promise<void>[] = [];
        for (let counter = 0; counter < 10; ++counter) {
            const i = counter;
            promises.push(queue.push(async () => {
                if (state.get(i)) {
                    throw new Error(`We shouldn't have set state[${i}] yet`);
                }
                state.set(i, true);
                for (let j = 0; j < i; ++j) {
                    queue.block(100);
                    if (!state.get(j)) {
                        throw new Error(`We should have set state[${j}] already`);
                    }
                }
                if (i % 2 === 0) {
                    // Arbitrary call to `delay()`.
                    queue.block(20);
                }
            }));
        }

        queue.block(100);

        await Promise.all(promises);
        for (let i = 0; i < 10; ++i) {
            if (!state.get(i)) {
                throw new Error(`This is the end of the test, we should have set state[${i}]`);
            }
        }

        // Give code a little bit more time to trip itself, in case `promises` are accidentally
        // resolved too early.
        await new Promise(resolve => setTimeout(resolve, 1000));

        queue.dispose();
    });
});


