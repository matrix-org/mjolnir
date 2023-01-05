/*
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

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

import {
    LogLevel,
    LogService,
    MatrixGlob,
    getRequestFn,
    setRequestFn,
} from "matrix-bot-sdk";
import { ClientRequest, IncomingMessage } from "http";
import { default as parseDuration } from "parse-duration";
import * as Sentry from '@sentry/node';
import * as _ from '@sentry/tracing'; // Performing the import activates tracing.
import { collectDefaultMetrics, Counter, Histogram, register } from "prom-client";

import ManagementRoomOutput from "./ManagementRoomOutput";
import { IHealthConfig } from "./config";
import { MatrixSendClient } from "./MatrixEmitter";

// Define a few aliases to simplify parsing durations.

parseDuration["days"] = parseDuration["day"];
parseDuration["weeks"] = parseDuration["week"] = parseDuration["wk"];
parseDuration["months"] = parseDuration["month"];
parseDuration["years"] = parseDuration["year"];

// ... and reexport it
export { parseDuration };


export function htmlEscape(input: string): string {
    return input.replace(/["&<>]/g, (char: string) => ({
        ['"'.charCodeAt(0)]: "&quot;",
        ["&".charCodeAt(0)]: "&amp;",
        ["<".charCodeAt(0)]: "&lt;",
        [">".charCodeAt(0)]: "&gt;"
    })[char.charCodeAt(0)]);
}

export function setToArray<T>(set: Set<T>): T[] {
    const arr: T[] = [];
    for (const v of set) {
        arr.push(v);
    }
    return arr;
}

export function isTrueJoinEvent(event: any): boolean {
    const membership = event['content']['membership'] || 'join';
    let prevMembership = "leave";
    if (event['unsigned'] && event['unsigned']['prev_content']) {
        prevMembership = event['unsigned']['prev_content']['membership'] || 'leave';
    }

    // We look at the previous membership to filter out profile changes
    return membership === 'join' && prevMembership !== "join";
}

/**
 * Redact a user's messages in a set of rooms.
 * See `getMessagesByUserIn`.
 *
 * @param client Client to redact the messages with.
 * @param managementRoom Management room to log messages back to.
 * @param userIdOrGlob A mxid or a glob which is applied to the whole sender field of events in the room, which will be redacted if they match.
 * See `MatrixGlob` in matrix-bot-sdk.
 * @param targetRoomIds Rooms to redact the messages from.
 * @param limit The number of messages to redact from most recent first. If the limit is reached then no further messages will be redacted.
 * @param noop Whether to operate in noop mode.
 */
export async function redactUserMessagesIn(client: MatrixSendClient, managementRoom: ManagementRoomOutput, userIdOrGlob: string, targetRoomIds: string[], limit = 1000, noop = false) {
    for (const targetRoomId of targetRoomIds) {
        await managementRoom.logMessage(LogLevel.DEBUG, "utils#redactUserMessagesIn", `Fetching sent messages for ${userIdOrGlob} in ${targetRoomId} to redact...`, targetRoomId);

        await getMessagesByUserIn(client, userIdOrGlob, targetRoomId, limit, async (eventsToRedact) => {
            for (const victimEvent of eventsToRedact) {
                await managementRoom.logMessage(LogLevel.DEBUG, "utils#redactUserMessagesIn", `Redacting ${victimEvent['event_id']} in ${targetRoomId}`, targetRoomId);
                if (!noop) {
                    await client.redactEvent(targetRoomId, victimEvent['event_id']);
                } else {
                    await managementRoom.logMessage(LogLevel.WARN, "utils#redactUserMessagesIn", `Tried to redact ${victimEvent['event_id']} in ${targetRoomId} but Mjolnir is running in no-op mode`, targetRoomId);
                }
            }
        });
    }
}

/**
 * Gets all the events sent by a user (or users if using wildcards) in a given room ID, since
 * the time they joined.
 * @param {MatrixSendClient} client The client to use.
 * @param {string} sender The sender. A matrix user id or a wildcard to match multiple senders e.g. *.example.com.
 * Can also be used to generically search the sender field e.g. *bob* for all events from senders with "bob" in them.
 * See `MatrixGlob` in matrix-bot-sdk.
 * @param {string} roomId The room ID to search in.
 * @param {number} limit The maximum number of messages to search. Defaults to 1000. This will be a greater or equal
 * number of events that are provided to the callback if a wildcard is used, as not all events paginated
 * will match the glob. The reason the limit is calculated this way is so that a caller cannot accidentally
 * traverse the entire room history.
 * @param {function} cb Callback function to handle the events as they are received.
 * The callback will only be called if there are any relevant events.
 * @returns {Promise<void>} Resolves when either: the limit has been reached, no relevant events could be found or there is no more timeline to paginate.
 */
export async function getMessagesByUserIn(client: MatrixSendClient, sender: string, roomId: string, limit: number, cb: (events: any[]) => void): Promise<void> {
    const isGlob = sender.includes("*");
    const roomEventFilter = {
        rooms: [roomId],
        ... isGlob ? {} : {senders: [sender]}
    };

    const matcher = new MatrixGlob(sender);

    function testUser(userId: string): boolean {
        if (isGlob) {
            return matcher.test(userId);
        } else {
            return userId === sender;
        }
    }

    /**
     * The response returned from `backfill`
     * See https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3roomsroomidmessages
     * for what the fields mean in detail. You have to read the spec even with the summary.
     * The `chunk` contains the events in reverse-chronological order.
     * The `end` is a token for the end of the `chunk` (where the older events are).
     * The `start` is a token for the beginning of the `chunk` (where the most recent events are).
     */
    interface BackfillResponse {
        chunk?: any[],
        end?: string,
        start: string
    }

    /**
     * Call `/messages` "backwards".
     * @param from a token that was returned previously from this API to start paginating from or
     * if `null`, start from the most recent point in the timeline.
     * @returns The response part of the `/messages` API, see `BackfillResponse`.
     */
    async function backfill(from: string|null): Promise<BackfillResponse> {
        const qs = {
            filter: JSON.stringify(roomEventFilter),
            dir: "b",
            ... from ? { from } : {}
        };
        LogService.info("utils", "Backfilling with token: " + from);
        return client.doRequest("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, qs);
    }

    let processed = 0;
    /**
     * Filter events from the timeline to events that are from a matching sender and under the limit that can be processed by the callback.
     * @param events Events from the room timeline.
     * @returns Events that can safely be processed by the callback.
     */
    function filterEvents(events: any[]) {
        const messages: any[] = [];
        for (const event of events) {
            if (processed >= limit) return messages; // we have provided enough events.
            processed++;

            if (testUser(event['sender'])) messages.push(event);
        }
        return messages;
    }
    // We check that we have the token because rooms/messages is not required to provide one
    // and will not provide one when there is no more history to paginate.
    let token: string|null = null;
    do {
        const bfMessages: BackfillResponse = await backfill(token);
        const previousToken: string|null = token;
        token = bfMessages['end'] ?? null;
        const events = filterEvents(bfMessages['chunk'] || []);
        // If we are using a glob, there may be no relevant events in this chunk.
        if (events.length > 0) {
            await cb(events);
        }
        // This check exists only because of a Synapse compliance bug https://github.com/matrix-org/synapse/issues/12102.
        // We also check after processing events as the `previousToken` can be 'null' if we are at the start of the steam
        // and `token` can also be 'null' as we have paginated the entire timeline, but there would be unprocessed events in the
        // chunk that was returned in this request.
        if (previousToken === token) {
            LogService.debug("utils", "Backfill returned same end token - returning early.");
            return;
        }
    } while (token && processed < limit)
}

let isMatrixClientPatchedForConciseExceptions = false;

/**
 * Patch `MatrixClient` into something that throws concise exceptions.
 *
 * By default, instances of `MatrixClient` throw instances of `IncomingMessage`
 * in case of many errors. Unfortunately, these instances are unusable:
 *
 * - they are logged as ~800 *lines of code*;
 * - there is no error message;
 * - they offer no stack.
 *
 * This method configures `MatrixClient` to ensure that methods that may throw
 * instead throws more reasonable insetances of `Error`.
 */
function patchMatrixClientForConciseExceptions() {
    if (isMatrixClientPatchedForConciseExceptions) {
        return;
    }
    let originalRequestFn = getRequestFn();
    setRequestFn((params: { [k: string]: any }, cb: any) => {
        // Store an error early, to maintain *some* semblance of stack.
        // We'll only throw the error if there is one.
        let error = new Error("STACK CAPTURE");
        originalRequestFn(params, function conciseExceptionRequestFn(
            err: { [key: string]: any }, response: { [key: string]: any }, resBody: string
        ) {
            if (!err && (response?.statusCode < 200 || response?.statusCode >= 300)) {
                // Normally, converting HTTP Errors into rejections is done by the caller
                // of `requestFn` within matrix-bot-sdk. However, this always ends up rejecting
                // with an `IncomingMessage` - exactly what we wish to avoid here.
                err = response;

                // Safety note: In the calling code within matrix-bot-sdk, if we return
                // an IncomingMessage as an error, we end up logging an unredacted response,
                // which may include tokens, passwords, etc. This could be a grave privacy
                // leak. The matrix-bot-sdk typically handles this by sanitizing the data
                // before logging it but, by converting the HTTP Error into a rejection
                // earlier than expected by the matrix-bot-sdk, we skip this step of
                // sanitization.
                //
                // However, since the error we're creating is an `IncomingMessage`, we
                // rewrite it into an `Error` ourselves in this function. Our `Error`
                // is even more sanitized (we only include the URL, HTTP method and
                // the error response) so we are NOT causing a privacy leak.
                if (!(err instanceof IncomingMessage)) {
                    // Safety check.
                    throw new TypeError("Internal error: at this stage, the error should be an IncomingMessage");
                }
            }
            if (!(err instanceof IncomingMessage)) {
                // In most cases, we're happy with the result.
                return cb(err, response, resBody);
            }
            // However, MatrixClient has a tendency of throwing
            // instances of `IncomingMessage` instead of instances
            // of `Error`. The former take ~800 lines of log and
            // provide no stack trace, which makes them typically
            // useless.
            let method: string | null = null;
            let path = '';
            let body: string | null = null;
            if (err.method) {
                method = err.method;
            }
            if (err.url) {
                path = err.url;
            }
            if ("req" in err && (err as any).req instanceof ClientRequest) {
                if (!method) {
                    method = (err as any).req.method;
                }
                if (!path) {
                    path = (err as any).req.path;
                }
            }
            if ("body" in err) {
                body = (err as any).body;
            }
            let message = `Error during MatrixClient request ${method} ${path}: ${err.statusCode} ${err.statusMessage} -- ${body}`;
            error.message = message;
            if (body) {
                // Calling code may use `body` to check for errors, so let's
                // make sure that we're providing it.
                try {
                    body = JSON.parse(body);
                } catch (ex) {
                    // Not JSON.
                }
                // Define the property but don't make it visible during logging.
                Object.defineProperty(error, "body", {
                    value: body,
                    enumerable: false,
                });
            }
            // Calling code may use `statusCode` to check for errors, so let's
            // make sure that we're providing it.
            if ("statusCode" in err) {
                // Define the property but don't make it visible during logging.
                Object.defineProperty(error, "statusCode", {
                    value: err.statusCode,
                    enumerable: false,
                });
            }
            if (!LogService.level.includes(LogLevel.TRACE)) {
                // Remove stack trace to reduce impact on logs.
                error.stack = "";
            }
            return cb(error, response, resBody);
        })
    });
    isMatrixClientPatchedForConciseExceptions = true;
}

const MAX_REQUEST_ATTEMPTS = 15;
const REQUEST_RETRY_BASE_DURATION_MS = 100;

const TRACE_CONCURRENT_REQUESTS = false;
let numberOfConcurrentRequests = 0;
let isMatrixClientPatchedForRetryWhenThrottled = false;
/**
 * Patch instances of MatrixClient to make sure that it retries requests
 * in case of throttling.
 *
 * Note: As of this writing, we do not re-attempt requests that timeout,
 * only request that are throttled by the server. The rationale is that,
 * in case of DoS, we do not wish to make the situation even worse.
 */
function patchMatrixClientForRetry() {
    if (isMatrixClientPatchedForRetryWhenThrottled) {
        return;
    }
    let originalRequestFn = getRequestFn();
    setRequestFn(async (params: { [k: string]: any }, cb: any) => {
        let attempt = 1;
        numberOfConcurrentRequests += 1;
        if (TRACE_CONCURRENT_REQUESTS) {
            console.trace("Current number of concurrent requests", numberOfConcurrentRequests);
        }
        try {
            while (true) {
                try {
                    let result: any[] = await new Promise((resolve, reject) => {
                        originalRequestFn(params, function requestFnWithRetry(
                            err: { [key: string]: any }, response: { [key: string]: any }, resBody: string
                        ) {
                            // Note: There is no data race on `attempt` as we `await` before continuing
                            // to the next iteration of the loop.
                            if (attempt < MAX_REQUEST_ATTEMPTS && err?.body?.errcode === 'M_LIMIT_EXCEEDED') {
                                // We need to retry.
                                reject(err);
                            } else {
                                if (attempt >= MAX_REQUEST_ATTEMPTS) {
                                    LogService.warn('Mjolnir.client', `Retried request ${params.method} ${params.uri} ${attempt} times, giving up.`);
                                }
                                // No need-to-retry error? Lucky us!
                                // Note that this may very well be an error, just not
                                // one we need to retry.
                                resolve([err, response, resBody]);
                            }
                        });
                    });
                    // This is our final result.
                    // Pass result, whether success or error.
                    return cb(...result);
                } catch (err) {
                    // Need to retry.
                    let retryAfterMs = attempt * attempt * REQUEST_RETRY_BASE_DURATION_MS;
                    if ("retry_after_ms" in err) {
                        try {
                            retryAfterMs = Number.parseInt(err.retry_after_ms, 10);
                        } catch (ex) {
                            // Use default value.
                        }
                    }
                    LogService.debug("Mjolnir.client", `Waiting ${retryAfterMs}ms before retrying ${params.method} ${params.uri}`);
                    await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                    attempt += 1;
                }
            }
        } finally {
            numberOfConcurrentRequests -= 1;
        }
    });
    isMatrixClientPatchedForRetryWhenThrottled = true;
}

/**
 * Perform any patching deemed necessary to MatrixClient.
 */
export function patchMatrixClient() {
    // Note that the order of patches is meaningful.
    //
    // - `patchMatrixClientForConciseExceptions` converts all `IncomingMessage`
    //   errors into instances of `Error` handled as errors;
    // - `patchMatrixClientForRetry` expects that all errors are returned as
    //   errors.
    patchMatrixClientForConciseExceptions();
    patchMatrixClientForRetry();
}

/**
 * Initialize performance measurements for the matrix client.
 *
 * This method is idempotent. If `config` specifies that Open Metrics
 * should not be used, it does nothing.
 */
export function initializeGlobalPerformanceMetrics(config: IHealthConfig) {
    if (isGlobalPerformanceMetricsCollectorInitialized || !config.health?.openMetrics?.enabled) {
        return;
    }

    // Collect the Prometheus-recommended metrics.
    collectDefaultMetrics({ register });

    // Collect matrix-bot-sdk-related metrics.
    let originalRequestFn = getRequestFn();
    let perfHistogram = new Histogram({
        name: "mjolnir_performance_http_request",
        help: "Duration of HTTP requests in seconds",
    });
    let successfulRequestsCounter = new Counter({
        name: "mjolnir_status_api_request_pass",
        help: "Number of successful API requests",
    });
    let failedRequestsCounter = new Counter({
        name: "mjolnir_status_api_request_fail",
        help: "Number of failed API requests",
    });
    setRequestFn(async (params: { [k: string]: any }, cb: any) => {
        let timer = perfHistogram.startTimer();
        return await originalRequestFn(params, function(error: object, response: any, body: string) {
            // Stop timer before calling callback.
            timer();
            if (error) {
                failedRequestsCounter.inc();
            } else {
                successfulRequestsCounter.inc();
            }
            cb(error, response, body);
        });
    });
    isGlobalPerformanceMetricsCollectorInitialized = true;
}
let isGlobalPerformanceMetricsCollectorInitialized = false;

/**
 * Initialize Sentry for error monitoring and reporting.
 *
 * This method is idempotent. If `config` specifies that Sentry
 * should not be used, it does nothing.
 */
export function initializeSentry(config: IHealthConfig) {
    if (sentryInitialized) {
        return;
    }
    if (config.health?.sentry) {
        // Configure error monitoring with Sentry.
        let sentry = config.health.sentry;
        Sentry.init({
            dsn: sentry.dsn,
            tracesSampleRate: sentry.tracesSampleRate,
        });
        sentryInitialized = true;
    }
}
// Set to `true` once we have initialized `Sentry` to ensure
// that we do not attempt to initialize it more than once.
let sentryInitialized = false;
