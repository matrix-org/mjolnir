/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import { Protection } from "./IProtection";
import { DurationMSProtectionSetting, NumberProtectionSetting, StringSetProtectionSetting } from "./ProtectionSettings";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, UserID } from "matrix-bot-sdk";

const DEFAULT_BUCKET_DURATION_MS = 10_000;
const DEFAULT_BUCKET_NUMBER = 6;
const DEFAULT_CLEANUP_PERIOD_MS = 3_600 * 1_000;
const DEFAULT_INITIAL_DELAY_GRACE_MS = 180_000;
const DEFAULT_LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS = 120_000;
const DEFAULT_LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS = 100_000;
const DEFAULT_FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS = 180_000;
const DEFAULT_FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS = 150_000;
const DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_ENTER_WARNING_ZONE = 20;
const DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_EXIT_WARNING_ZONE = 10;
const DEFAULT_REWARN_AFTER_MS = 60_000;

/**
 * A state event emitted in the moderation room when there is lag,
 * redacted when lag has disappeared.
 *
 * The state key is the id of the room in which lag was detected.
 */
export const LAG_STATE_EVENT = "org.mjolnir.monitoring.lag";

/**
 * Settings for a timed histogram.
 */
type HistogramSettings = {
    // The width of a bucket, in ms.
    bucketDurationMS: number,
    // The number of buckets.
    bucketNumber: number;
}

/**
 * A histogram with time as x and some arbitrary value T as y.
 */
class TimedHistogram<T> {
    /**
     * An array of at most `this.settings.bucketNumber` buckets of events.
     *
     * Each bucket gathers all events that were pushed during an interval of
     * `this.settings.bucketDurationMS` starting at `bucket.timeStamp`.
     *
     * `0` is the oldest bucket.
     * ..
     * `length - 1` is the most recent bucket.
     *
     * Notes:
     * - this is a sparse array, buckets are not necessarily adjacent;
     * - if `this.updateSettings()` is called, we do not redistribute events
     *   between buckets, so it may take some time before statistics fully
     *   respect the new settings.
     */
    protected buckets: {
        start: Date;
        events: T[]
    }[];

    /**
     * Construct an empty TimedHistogram
     */
    constructor(private settings: HistogramSettings) {
        this.buckets = []
    }

    /**
     * Push a new event into the histogram.
     *
     * New events are always considered most recent, without checking `new`.
     * If pushing a new event causes the histogram to overflow, oldest buckets
     * are removed.
     *
     * @param event The event to push.
     * @param now The current date, used to create a new bucket to the event if
     *  necessary and to determine whether some buckets are too old.
     */
    push(event: T, now: Date) {
        let timeStamp = now.getTime();
        let latestBucket = this.buckets[this.buckets.length - 1];
        if (latestBucket && latestBucket.start.getTime() + this.settings.bucketDurationMS >= timeStamp) {
            // We're still within `durationPerColumnMS` of latest entry, we can reuse that entry.
            latestBucket.events.push(event);
            return;
        }
        // Otherwise, initialize an entry, then prune columns that are too old.
        this.buckets.push({
            start: now,
            events: [event]
        });
        this.trimBuckets(this.settings, now);
    }

    /**
     * If any buckets are too old, remove them. If there are (still) too
     * many buckets, remove the oldest ones.
     */
    private trimBuckets(settings: HistogramSettings, now: Date) {
        if (this.buckets.length > settings.bucketNumber) {
            this.buckets.splice(0, this.buckets.length - settings.bucketNumber);
        }
        const oldestAcceptableTimestamp = now.getTime() - settings.bucketDurationMS * settings.bucketNumber;
        for (let i = this.buckets.length - 2; i >= 0; --i) {
            // Find the most recent bucket that is too old.
            if (this.buckets[i].start.getTime() < oldestAcceptableTimestamp) {
                // ...and remove that bucket and every bucket before it.
                this.buckets.splice(0, i + 1);
                break;
            }
        }
    }

    /**
     * Change the settings of a histogram.
     */
    public updateSettings(settings: HistogramSettings, now: Date) {
        this.trimBuckets(settings, now);
        this.settings = settings;
    }
}

/**
 * General-purpose statistics on a sample.
 */
class Stats {
    // Minimum.
    public readonly min: number;
    // Maximum.
    public readonly max: number;
    // Mean.
    public readonly mean: number;
    // Median.
    public readonly median: number;
    // Standard deviation.
    public readonly stddev: number;
    // Length of the sample.
    public readonly length: number;

    constructor(values: number[]) {
        this.length = values.length;
        if (this.length === 0) {
            throw new TypeError("Attempting to compute stats on an empty sample");
        }
        if (this.length === 1) {
            // `values[Math.ceil(this.length / 2)]` below fails when `this.length == 1`.
            this.min =
                this.max =
                this.mean =
                this.median = values[0];
            this.stddev = 0;
            return;
        }
        values.sort((a, b) => a - b); // Don't forget to force sorting by value, not by stringified value!
        this.min = values[0];
        this.max = values[this.length - 1];
        let total = 0;
        for (let num of values) {
            total += num;
        }
        this.mean = total / this.length;

        let totalVariance = 0;
        for (let num of values) {
            const deviation = num - this.mean;
            totalVariance += deviation * deviation;
        }
        this.stddev = Math.sqrt(totalVariance / this.length);

        if (this.length % 2 === 0) {
            this.median = values[this.length / 2];
        } else {
            this.median = (values[Math.floor(this.length / 2)] + values[Math.ceil(this.length / 2)]) / 2;
        }
    }

    public round(): { min: number, max: number, mean: number, median: number, stddev: number, length: number } {
        return {
            min: Math.round(this.min),
            max: Math.round(this.max),
            mean: Math.round(this.mean),
            median: Math.round(this.median),
            stddev: Math.round(this.stddev),
            length: this.length
        }
    }
}

/**
 * A subclass of TimedHistogram that supports only numbers
 * and can compute statistics.
 */
class NumbersTimedHistogram extends TimedHistogram<number> {
    constructor(settings: HistogramSettings) {
        super(settings);
    }

    /**
     * Compute stats.
     *
     * @returns `null` if the histogram is empty, otherwise `Stats`.
     */
    public stats(): Stats | null {
        if (this.buckets.length === 0) {
            return null;
        }
        let numbers = [];
        for (let bucket of this.buckets) {
            numbers.push(...bucket.events);
        }
        if (numbers.length === 0) {
            return null;
        }
        return new Stats(numbers);
    }
}

/**
 * Lag information on a server for a specific room.
 *
 * The same server may be represented by distinct instances of `ServerInfo` in
 * distinct rooms.
 */
class ServerInfo {
    /**
     * The histogram collecting lag, in ms.
     */
    private histogram: NumbersTimedHistogram;

    /**
     * Date of the latest message received from this server.
     *
     * May be used to clean up data structures.
     */
    public latestMessage: Date = new Date(0);
    public latestStatsUpdate: Date;

    constructor(settings: HistogramSettings, now: Date) {
        this.histogram = new NumbersTimedHistogram(settings);
        this.latestStatsUpdate = now;
    }

    /**
     * Record lag information on this server.
     *
     * @param lag The duration of lag, in ms.
     */
    pushLag(lag: number, now: Date) {
        this.latestMessage = now;
        this.histogram.push(lag, now);
    }

    updateSettings(settings: HistogramSettings, now: Date) {
        this.histogram.updateSettings(settings, now);
    }

    /**
     * Compute stats.
     *
     * @returns `null` if the histogram is empty, otherwise `Stats`.
     */
    stats(now?: Date) {
        if (now) {
            this.latestStatsUpdate = now;
        }
        return this.histogram.stats();
    }
}

/**
 * Thresholds to start/stop warning of an issue.
 *
 * Once we have hit a value higher that `enterWarningZone`, the alert
 * will remain active until the value decreases below `exitWarningZone`.
 */
type WarningThresholds = {
    enterWarningZone: number,
    exitWarningZone: number
}

enum AlertDiff {
    Start,
    Stop,
    NoChange
}

/**
 * Statistics to help determine whether we should raise the alarm on lag in a room.
 *
 * Each individual server may have lag.
 */
class RoomInfo {
    /**
     * A map of domain => lag information.
     */
    private serverLags: Map<string /* domain */, ServerInfo> = new Map();
    /**
     * The set of servers currently on alert.
     */
    private serverAlerts: Set<string /* domain */> = new Set();

    /**
     * Global lag information for this room.
     */
    public totalLag: ServerInfo;

    /**
     * If non-`null`, the date at which this room started being on alert.
     * Otherwise, the room is not an alert.
     */
    public latestAlertStart: Date | null;

    /**
     * The date at which we last issued a warning on this room.
     *
     * Used to avoid spamming the monitoring room with too many warnings per room.
     */
    public latestWarning: Date = new Date(0);

    /**
     * If non-`null`, we have issued a structured warning as a state event.
     * This needs to be redacted once the alert has passed.
     */
    public warnStateEventId: string | null = null;

    /**
     * The date at which we last received a message in this room.
     */
    public latestMessage: Date = new Date(0);

    constructor(now: Date) {
        this.serverLags = new Map();
        this.totalLag = new ServerInfo({
            bucketDurationMS: DEFAULT_BUCKET_DURATION_MS,
            bucketNumber: DEFAULT_BUCKET_NUMBER
        }, now);
    }

    /**
     * Add a lag annotation.
     *
     * @param serverId The server from which the message was sent. Could be the local server.
     * @param lag How many ms of lag was measured. Hopefully ~0.
     * @param settings Settings used in case we need to create or update the histogram.
     * @param thresholds The thresholds to use to determine whether an origin server is currently lagging.
     * @param now Instant at which all of this was measured.
     */
    pushLag(serverId: string, lag: number, settings: HistogramSettings, thresholds: WarningThresholds, now: Date = new Date()): AlertDiff {
        this.latestMessage = now;

        // Update per-server lag.
        let serverInfo = this.serverLags.get(serverId);
        if (!serverInfo) {
            serverInfo = new ServerInfo(settings, now);
            this.serverLags.set(serverId, serverInfo);
        } else {
            serverInfo.updateSettings(settings, now);
        }
        serverInfo.pushLag(lag, now);

        // Update global lag.
        this.totalLag.updateSettings(settings, now);
        this.totalLag.pushLag(lag, now);

        // Check for alerts, if necessary.
        if (serverInfo.latestStatsUpdate.getTime() + settings.bucketDurationMS > now.getTime()) {
            // Too early to recompute stats.
            return AlertDiff.NoChange;
        }

        let stats = serverInfo.stats(now)!;
        if (stats.median > thresholds.enterWarningZone) {
            // Oops, we're now on alert for this server.
            let previous = this.serverAlerts.has(serverId);
            if (!previous) {
                this.serverAlerts.add(serverId);
                return AlertDiff.Start;
            }
        } else if (stats.median < thresholds.exitWarningZone) {
            // Ah, we left the alert zone.
            let previous = this.serverAlerts.has(serverId);
            if (previous) {
                this.serverAlerts.delete(serverId);
                return AlertDiff.Stop;
            }
        }
        return AlertDiff.NoChange;
    }

    /**
     * The number of servers currently on alert.
     */
    public get alerts(): number {
        return this.serverAlerts.size;
    }

    /**
     * The current global stats.
     *
     * These stats are not separated by remote server.
     *
     * @returns null if we have no recent data at all,
     * some stats otherwise.
     */
    public globalStats(): Stats | null {
        return this.totalLag.stats();
    }

    /**
     * Check if a server is currently marked as lagging.
     *
     * A server is marked as lagging if its mean lag has exceeded
     * `threshold.enterWarningZone` and has not decreased below
     * `threshold.exitWarningZone`.
     *
     * @returns `true` is that server is currently on alert.
     */
    public isServerOnAlert(serverId: string): boolean {
        return this.serverAlerts.has(serverId);
    }

    /**
     * The list of servers currently on alert.
     */
    public serversOnAlert(): IterableIterator<string> {
        return this.serverAlerts.keys();
    }

    public cleanup(settings: HistogramSettings, now: Date, oldest: Date) {
        // Cleanup global histogram.
        //
        // If `oldest == now - settings.duration * settings.number`, this
        // should correspond exactly to the cleanup that takes place within
        // `this.serverLags`. There is a risk of inconsistency between data
        // if this is not the case.
        //
        // We assume that this is an acceptable risk: as we regularly
        // erase oldest data from both `this.totalLag` and individual
        // entries of `this.serverLags`, both sets of data will eventually
        // catch up with each other.
        this.totalLag.updateSettings(settings, now);
        let serverLagsDeleteIds = [];
        for (let [serverId, serverStats] of this.serverLags) {
            if (serverStats.latestMessage < oldest) {
                // Remove entire histogram.
                serverLagsDeleteIds.push(serverId);
                continue;
            }
            // Cleanup histogram.
            serverStats.updateSettings(settings, now);
        }
        for (let key of serverLagsDeleteIds) {
            this.serverLags.delete(key);
            this.serverAlerts.delete(key);
            // Note that we remove the alert to save memory (it's not really useful
            // to keep monitoring a server for too long after receiving a message)
            // but this does NOT guaranteed that server lag is over. It may be that
            // the server is down or that the server is lagging by more than ~1h
            // (by default).
        }
    }
}

export class DetectFederationLag extends Protection {
    /**
     * For each room we're monitoring, lag information.
     */
    lagPerRoom: Map<string /* roomId */, RoomInfo> = new Map();
    public settings = {
        // Rooms to ignore.
        ignoreRooms: new StringSetProtectionSetting(),
        // Servers to ignore, typically because they're known to be slow.
        ignoreServers: new StringSetProtectionSetting(),
        // How often we should recompute lag.
        bucketDuration: new DurationMSProtectionSetting(DEFAULT_BUCKET_DURATION_MS, 100),
        // How long we should remember lag in a room (`bucketDuration * bucketNumber` ms).
        bucketNumber: new NumberProtectionSetting(DEFAULT_BUCKET_NUMBER, 1),
        // How much lag before the local homeserver is considered lagging.
        localHomeserverLagEnterWarningZone: new DurationMSProtectionSetting(DEFAULT_LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS, 1),
        // How much lag before the local homeserver is considered not lagging anymore.
        localHomeserverLagExitWarningZone: new DurationMSProtectionSetting(DEFAULT_LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS, 1),
        // How much lag before a federated homeserver is considered lagging.
        federatedHomeserverLagEnterWarningZone: new DurationMSProtectionSetting(DEFAULT_FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS, 1),
        // How much lag before a federated homeserver is considered not lagging anymore.
        federatedHomeserverLagExitWarningZone: new DurationMSProtectionSetting(DEFAULT_FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS, 1),
        // How much time we should wait before printing a new warning.
        warnAgainAfter: new DurationMSProtectionSetting(DEFAULT_REWARN_AFTER_MS, 1),
        // How many federated homeservers it takes to trigger an alert.
        // You probably want to update this if you're monitoring a room that
        // has many underpowered homeservers.
        numberOfLaggingFederatedHomeserversEnterWarningZone: new NumberProtectionSetting(DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_ENTER_WARNING_ZONE, 1),
        // How many federated homeservers it takes before we're considered not on alert anymore.
        // You probably want to update this if you're monitoring a room that
        // has many underpowered homeservers.
        numberOfLaggingFederatedHomeserversExitWarningZone: new NumberProtectionSetting(DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_EXIT_WARNING_ZONE, 1),
        // How long to wait before actually collecting statistics.
        // Used to avoid being misled by Mjölnir catching up with old messages on first sync.
        initialDelayGrace: new DurationMSProtectionSetting(DEFAULT_INITIAL_DELAY_GRACE_MS, 0),
        cleanupPeriod: new DurationMSProtectionSetting(DEFAULT_CLEANUP_PERIOD_MS, 1),
    };
    // The instant at which the first message was received.
    private firstMessage: Date | null = null;
    // The latest instant at which we have started cleaning up old data.
    private latestCleanup: Date = new Date(0);
    private latestHistogramSettings: HistogramSettings;
    constructor() {
        super();
        // Initialize and watch `this.latestHistogramSettings`.
        this.updateLatestHistogramSettings();
        this.settings.bucketDuration.on("set", () => this.updateLatestHistogramSettings());
        this.settings.bucketNumber.on("set", () => this.updateLatestHistogramSettings());
    }
    dispose() {
        this.settings.bucketDuration.removeAllListeners();
        this.settings.bucketNumber.removeAllListeners();
    }
    public get name(): string {
        return 'DetectFederationLag';
    }
    public get description(): string {
        return `Warn moderators if either the local homeserver starts lagging by ${this.settings.localHomeserverLagEnterWarningZone.value}ms or at least ${this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value} start lagging by at least ${this.settings.federatedHomeserverLagEnterWarningZone.value}ms.`;
    }

    /**
     * @param now An argument used only by tests, to simulate events taking place at a specific date.
     */
    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any, now: Date = new Date()) {
        // First, handle all cases in which we should ignore the event.
        if (!this.firstMessage) {
            this.firstMessage = now;
        }
        if (this.firstMessage.getTime() + this.settings.initialDelayGrace.value > now.getTime()) {
            // We're still in the initial grace period, ignore.
            return;
        }
        if (this.latestCleanup.getTime() + this.settings.cleanupPeriod.value > now.getTime()) {
            // We should run some cleanup.
            this.latestCleanup = now;
            this.cleanup(now);
        }
        if (this.settings.ignoreRooms.value.has(roomId)) {
            // Room is ignored.
            return;
        }
        const sender = event['sender'] as string;
        if (typeof sender !== "string") {
            // Ill-formed event.
            return;
        }
        if (sender === await mjolnir.client.getUserId()) {
            // Let's not create loops.
            return;
        }
        const domain = new UserID(sender).domain;
        if (!domain) {
            // Ill-formed event.
            return;
        }

        const origin = event['origin_server_ts'] as number;
        if (typeof origin !== "number" || isNaN(origin)) {
            // Ill-formed event.
            return;
        }
        const delay = now.getTime() - origin;
        if (delay < 0) {
            // Could be an ill-formed event.
            // Could be non-motonic clocks or other time shennanigans.
            return;
        }

        let roomInfo = this.lagPerRoom.get(roomId);
        if (!roomInfo) {
            roomInfo = new RoomInfo(now);
            this.lagPerRoom.set(roomId, roomInfo);
        }

        const localDomain = new UserID(await mjolnir.client.getUserId()).domain
        const isLocalDomain = domain === localDomain;
        const thresholds =
            isLocalDomain
                ? {
                    enterWarningZone: this.settings.localHomeserverLagEnterWarningZone.value,
                    exitWarningZone: this.settings.localHomeserverLagExitWarningZone.value,
                }
                : {
                    enterWarningZone: this.settings.federatedHomeserverLagEnterWarningZone.value,
                    exitWarningZone: this.settings.federatedHomeserverLagExitWarningZone.value,
                };

        const diff = roomInfo.pushLag(domain, delay, this.latestHistogramSettings, thresholds, now);
        if (diff === AlertDiff.NoChange) {
            return;
        }

        if (roomInfo.latestWarning.getTime() + this.settings.warnAgainAfter.value > now.getTime()) {
            if (!isLocalDomain || diff !== AlertDiff.Start) {
                // No need to check for alarms, we have raised an alarm recently.
                return;
            }
        }

        // Check whether an alarm needs to be raised!
        const isLocalDomainOnAlert = roomInfo.isServerOnAlert(localDomain);
        if (roomInfo.alerts > this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value
            || isLocalDomainOnAlert) {
            // Raise the alarm!
            if (!roomInfo.latestAlertStart) {
                roomInfo.latestAlertStart = now;
            }
            roomInfo.latestAlertStart = now;
            // Background-send message.
            const stats = roomInfo.globalStats();
            /* do not await */ mjolnir.logMessage(LogLevel.WARN, "FederationLag",
                `Room ${roomId} is experiencing ${isLocalDomainOnAlert ? "LOCAL" : "federated"} lag since ${roomInfo.latestAlertStart}.\n${roomInfo.alerts} homeservers are lagging: ${[...roomInfo.serversOnAlert()].sort()} .\nRoom lag statistics: ${JSON.stringify(stats, null, 2)}.`);
            // Drop a state event, for the use of potential other bots.
            const warnStateEventId = await mjolnir.client.sendStateEvent(mjolnir.managementRoomId, LAG_STATE_EVENT, roomId, {
                domains: [...roomInfo.serversOnAlert()],
                roomId,
                // We need to round the stats, as Matrix doesn't support floating-point
                // numbers in messages.
                stats: stats?.round(),
                since: roomInfo.latestAlertStart,
            });
            roomInfo.warnStateEventId = warnStateEventId;
        } else if (roomInfo.alerts < this.settings.numberOfLaggingFederatedHomeserversExitWarningZone.value
            || !isLocalDomainOnAlert) {
            // Stop the alarm!
            /* do not await */ mjolnir.logMessage(LogLevel.INFO, "FederationLag",
                `Room ${roomId} lag has decreased to an acceptable level. Currently, ${roomInfo.alerts} homeservers are still lagging`
            );
            if (roomInfo.warnStateEventId) {
                const warnStateEventId = roomInfo.warnStateEventId;
                roomInfo.warnStateEventId = null;
                await mjolnir.client.redactEvent(mjolnir.managementRoomId, warnStateEventId, "Alert over");
            }
        }
    }

    /**
     * Run cleanup on data structures, to save memory.
     *
     * @param now Now.
     * @param oldest Prune any data older than `oldest`.
     */
    public async cleanup(now: Date = new Date()) {
        const oldest: Date = this.getOldestAcceptableData(now);
        const lagPerRoomDeleteIds = [];
        for (const [roomId, roomInfo] of this.lagPerRoom) {
            if (roomInfo.latestMessage < oldest) {
                // We need to remove the entire room.
                lagPerRoomDeleteIds.push(roomId);
                continue;
            }
            // Clean room stats.
            roomInfo.cleanup(this.latestHistogramSettings, now, oldest);
        }
        for (const roomId of lagPerRoomDeleteIds) {
            this.lagPerRoom.delete(roomId);
        }
    }

    private getOldestAcceptableData(now: Date): Date {
        return new Date(now.getTime() - this.latestHistogramSettings.bucketDurationMS * this.latestHistogramSettings.bucketNumber)
    }
    private updateLatestHistogramSettings() {
        this.latestHistogramSettings = Object.freeze({
            bucketDurationMS: this.settings.bucketDuration.value,
            bucketNumber: this.settings.bucketNumber.value,
        });
    };

    /**
     * Return (mostly) human-readable lag status.
     */
    public async statusCommand(mjolnir: Mjolnir, subcommand: string[]): Promise<{html: string, text: string} | null> {
        const roomId = subcommand[0] || "*";
        const localDomain = new UserID(await mjolnir.client.getUserId()).domain;
        const annotatedStats = (roomInfo: RoomInfo) => {
            const stats = roomInfo.globalStats()?.round();
            if (!stats) {
                return null;
            }
            const isLocalDomainOnAlert = roomInfo.isServerOnAlert(localDomain);
            const numberOfServersOnAlert = roomInfo.alerts;
            if (isLocalDomainOnAlert) {
                (stats as any)["warning"] = "Local homeserver is lagging";
            } else if (numberOfServersOnAlert > this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value) {
                (stats as any)["warning"] = `${numberOfServersOnAlert} homeservers are lagging`;
            }
            return stats;
        };
        let text;
        let html;
        if (roomId === "*") {
            // Collate data from all protected rooms.
            const result: any = {};

            for (const [perRoomId, perRoomInfo] of this.lagPerRoom.entries()) {
                const key = await mjolnir.client.getPublishedAlias(perRoomId) || perRoomId;
                result[key] = annotatedStats(perRoomInfo);
            }
            text = JSON.stringify(result, null, 2);
            html = `<code>${JSON.stringify(result, null, "&nbsp;&nbsp;")}</code>`;
        } else {
            // Fetch data from a specific room.
            const roomInfo = this.lagPerRoom.get(roomId);
            if (!roomInfo) {
                html = text = `Either ${roomId} is unmonitored or it has received no messages in a while`;
            } else {
                // Fetch data from all remote homeservers.
                const stats = annotatedStats(roomInfo);
                if (!stats) {
                    html = text = `No recent messages in room ${roomId}`;
                } else {
                    text = JSON.stringify(stats, null, 2);
                    html = `<code>${JSON.stringify(stats, null, "&nbsp;&nbsp;")}</code>`;
                }
            }
        }
        return {
                text,
                html
        }
    }
}
