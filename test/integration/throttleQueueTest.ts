import { strict as assert } from "assert";

import { UserID } from "matrix-bot-sdk";
import { ThrottlingQueue } from "../../src/queues/ThrottlingQueue";

describe("Test: ThrottlingQueue", function() {
    it("Tasks enqueued with `push()` are executed exactly once and in the right order", async function() {
        this.timeout(20000);

        const queue = new ThrottlingQueue(this.mjolnir, 10);
        let state = new Map();
        let promises = [];
        for (let counter = 0; counter < 10; ++counter) {
            const i = counter;
            promises.push(queue.push(async () => {
                if (state.get(i)) {
                    throw new Error(`We shouldn't have set state[${i}] yet`);
                }
                state.set(i, true);
                for (let j = 0; j < i; ++j) {
                    if (!state.get(j)) {
                        throw new Error(`We should have set state[${j}] already`);
                    }
                }
            }));
        }
        await Promise.all(promises);
        // Give code a little bit more time to trip itself.
        await new Promise(resolve => setTimeout(resolve, 1000));
        for (let i = 0; i < 10; ++i) {
            if (!state.get(i)) {
                throw new Error(`This is the end of the test, we should have set state[${i}]`);
            }
        }

        queue.dispose();
    });

    it("Tasks enqueued with `pull()` are executed exactly once and in the right order", async function() {
        this.timeout(200000);
        const queue = new ThrottlingQueue(this.mjolnir, 10);
        let state = new Map();
        let promise;

        {
            let counter = 0;
            promise = queue.pull(async () => {
                if (counter == 10) {
                    return { done: true };
                }
                const i = counter++;
                return {
                    done: false,
                    value: async () => {
                        if (state.get(i)) {
                            throw new Error(`We shouldn't have set state[${i}] yet`);
                        }
                        state.set(i, true);
                        for (let j = 0; j < i; ++j) {
                            if (!state.get(j)) {
                                throw new Error(`We should have set state[${j}] already`);
                            }
                        }
                    }
                }
            });
        }
        await promise;
        for (let i = 0; i < 10; ++i) {
            if (!state.get(i)) {
                throw new Error(`This is the end of the test, we should have set state[${i}]`);
            }
        }

        queue.dispose();
    });

    it("Tasks enqueued with `push()` are executed exactly once and in the right order, even if we call `block()` at some point", async function() {
        this.timeout(20000);
        const queue = new ThrottlingQueue(this.mjolnir, 10);
        let state = new Map();
        let promises = [];
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
        // Give code a little bit more time to trip itself.
        await new Promise(resolve => setTimeout(resolve, 1000));
        for (let i = 0; i < 10; ++i) {
            if (!state.get(i)) {
                throw new Error(`This is the end of the test, we should have set state[${i}]`);
            }
        }

        queue.dispose();
    });

    it("Tasks enqueued with `pull()` are executed exactly once and in the right order, even if we call `block()` at some point", async function() {
        this.timeout(20000);
        const queue = new ThrottlingQueue(this.mjolnir, 10);
        let state = new Map();
        let promise;

        {
            let counter = 0;
            promise = queue.pull(async () => {
                if (counter == 10) {
                    return { done: true };
                }
                const i = counter++;
                return {
                    done: false,
                    value: async () => {
                        if (state.get(i)) {
                            throw new Error(`We shouldn't have set state[${i}] yet`);
                        }
                        state.set(i, true);
                        if (i % 3 === 0) {
                            // Arbitrary call to `delay()`.
                            queue.block(20);
                        }
                        for (let j = 0; j < i; ++j) {
                            if (!state.get(j)) {
                                throw new Error(`We should have set state[${j}] already`);
                            }
                        }
                    }
                }
            });
        }
        await promise;
        for (let i = 0; i < 10; ++i) {
            if (!state.get(i)) {
                throw new Error(`This is the end of the test, we should have set state[${i}]`);
            }
        }

        queue.dispose();
    });
});


