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
import { NumberProtectionSetting, StringSetProtectionSetting } from "./ProtectionSettings";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, UserID } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";

const DEFAULT_BUCKET_DURATION_MS = 10_000;
const DEFAULT_BUCKET_NUMBER = 6;
const DEFAULT_LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS = 120_000;
const DEFAULT_LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS = 100_000;
const DEFAULT_FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS = 180_000;
const DEFAULT_FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS = 150_000;
const DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_ENTER_WARNING_ZONE = 20;
const DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_EXIT_WARNING_ZONE = 10;
const DEFAULT_REWARN_AFTER_MS = 60_000;

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
    push(event: T, now: Date = new Date()) {
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
    private trimBuckets(settings: HistogramSettings, now: Date = new Date()) {
        if (this.buckets.length > settings.bucketNumber) {
            this.buckets.splice(0, this.buckets.length - settings.bucketNumber);
        }
        const oldestAcceptableTimestamp = now.getTime() - settings.bucketDurationMS * settings.bucketNumber;
        for (let i = this.buckets.length - 2; i >=0; --i) {
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
    public updateSettings(settings: HistogramSettings, now: Date = new Date()) {
        this.trimBuckets(settings, now);
        this.settings = settings;
    }
}

/**
 * General-purpose statistics on a sample.
 */
type Stats = {
    // Minimum.
    min: number,
    // Maximum.
    max: number,
    // Mean.
    mean: number,
    // Median.
    median: number,
    // Standard deviation.
    stddev: number,
    // Length of the sample.
    length: number,
}

/**
 * A subclass of TimedHistogram that supports only numbers
 * and can compute statistics.
 */
class NumbersTimedHistogram extends TimedHistogram<number> {
    private _latestStatsUpdate: Date;
    constructor(settings: HistogramSettings, now = new Date()) {
        super(settings);
        this._latestStatsUpdate = now;
    }

    /**
     * The instant at which `stats()` was last called.
     */
    public get latestStatsUpdate() {
        return this._latestStatsUpdate;
    }

    /**
     * Compute stats.
     *
     * @returns `null` if the histogram is empty, otherwise `Stats`.
     */
    public stats(now: Date = new Date()): Stats|null {
        this._latestStatsUpdate = now;
        if (this.buckets.length == 0) {
            return null;
        }
        let numbers = [];
        for (let bucket of this.buckets) {
            numbers.push(...bucket.events);
        }
        if (numbers.length == 0) {
            return null;
        }
        numbers.sort();
        const length = numbers.length;
        const min = numbers[0];
        const max = numbers[length - 1];
        let total = 0;
        for (let num of numbers) {
            total += num;
        }
        const mean = total / length;

        let totalVariance = 0;
        for (let num of numbers) {
            const deviation = num - mean;
            totalVariance += deviation * deviation;
        }
        const stddev = Math.sqrt(totalVariance / length);

        let median;
        if (length % 2 == 0) {
            median = numbers[length / 2];
        } else {
            median = (numbers[Math.floor(length / 2)] + numbers[Math.ceil(length / 2)]) / 2;
        }

        return {
            min,
            max,
            mean,
            stddev,
            median,
            length
        }
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
    public histogram: NumbersTimedHistogram;

    /**
     * Date of the latest message received from this server.
     * 
     * May be used to clean up data structures.
     */
    public latestMessage: Date = new Date(0);

    constructor(settings: HistogramSettings, now: Date = new Date()) {
        this.histogram = new NumbersTimedHistogram(settings, now);
    }

    /**
     * Record lag information on this server.
     *
     * @param lag The duration of lag, in ms.
     */
    addLag(lag: number, now: Date = new Date()) {
        this.latestMessage = now;
        this.histogram.push(lag, now);
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

/**
 * Statistics to help determine whether we should raise the alarm on lag in a room.
 * 
 * Each individual server may have lag.
 */
class RoomStats {
    constructor() {
        this.serverLags = new Map();
        this.totalLag = new ServerInfo({
            bucketDurationMS: DEFAULT_BUCKET_DURATION_MS,
            bucketNumber: DEFAULT_BUCKET_NUMBER
        });
    }
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
    public warnStateEventId: string|null = null;

    /**
     * Add a lag annotation.
     *
     * @param serverId The server from which the message was sent. Could be the local server.
     * @param lag How many ms of lag was measured. Hopefully ~0.
     * @param settings Settings used in case we need to create or update the histogram.
     * @param now Instant at which all of this was measured.
     */
    addLag(serverId: string, lag: number, settings: HistogramSettings, thresholds: WarningThresholds, now: Date = new Date()) {
        // Update per-server lag.
        let serverInfo = this.serverLags.get(serverId);
        if (!serverInfo) {
            serverInfo = new ServerInfo(settings);
            this.serverLags.set(serverId, serverInfo);
        } else {
            serverInfo.histogram.updateSettings(settings, now);
        }
        serverInfo.addLag(lag, now);

        // Update global lag.
        this.totalLag.histogram.updateSettings(settings, now);
        this.totalLag.addLag(lag, now);

        // Check for alerts, if necessary.
        if (serverInfo.histogram.latestStatsUpdate.getTime() + settings.bucketDurationMS > now.getTime()) {
            // Too early to recompute stats.
            return;
        }

        let stats = serverInfo.histogram.stats(now)!;
        if (stats.median > thresholds.enterWarningZone) {
            // Oops, we're now on alert for this server.
            this.serverAlerts.add(serverId);
        } else if (stats.median < thresholds.exitWarningZone) {
            // Ah, we left the alert zone.
            this.serverAlerts.delete(serverId);
        }
    }

    /**
     * The number of servers currently on alert.
     */
    public get alerts(): number {
        return this.serverAlerts.size;
    }

    /**
     * @param serverId 
     * @returns `true` is that server is currently on alert.
     */
    public isServerOnAlert(serverId: string): boolean {
        return this.serverAlerts.has(serverId);
    }

    /**
     * The histogram for global performance in this room.
     */
    public get histogram(): NumbersTimedHistogram {
        return this.totalLag.histogram;
    }
}

export class DetectFederationLag extends Protection {
    /**
     * For each room we're monitoring, lag information.
     */
    lagPerRoom: Map<string /* roomId */, RoomStats> = new Map();
    settings = {
        // Rooms to ignore.
        ignoreRooms: new StringSetProtectionSetting(),
        // Servers to ignore, typically because they're known to be slow.
        ignoreServers: new StringSetProtectionSetting(),
        // How often we should recompute lag (ms).
        bucketDurationMS: new NumberProtectionSetting(DEFAULT_BUCKET_DURATION_MS),
        // How long we should remember lag in a room (`bucketDuration * bucketNumber` ms).
        bucketNumber: new NumberProtectionSetting(DEFAULT_BUCKET_NUMBER),
        // How much lag before the local homeserver is considered lagging.
        localHomeserverLagEnterWarningZone: new NumberProtectionSetting(DEFAULT_LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS),
        // How much lag before the local homeserver is considered not lagging anymore.
        localHomeserverLagExitWarningZone: new NumberProtectionSetting(DEFAULT_LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS),
        // How much lag before a federated homeserver is considered lagging.
        federatedHomeserverLagEnterWarningZone: new NumberProtectionSetting(DEFAULT_FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS),
        // How much lag before a federated homeserver is considered not lagging anymore.
        federatedHomeserverLagExitWarningZone: new NumberProtectionSetting(DEFAULT_FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS),
        // How much time we should wait before printing a new warning (ms).
        warnAgainAfterMS: new NumberProtectionSetting(DEFAULT_REWARN_AFTER_MS),
        // How many federated homeservers it takes to trigger an alert.
        // You probably want to update this if you're monitoring a room that
        // has many underpowered homeservers.
        numberOfLaggingFederatedHomeserversEnterWarningZone: new NumberProtectionSetting(DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_ENTER_WARNING_ZONE),
        // How many federated homeservers it takes before we're considered not on alert anymore.
        // You probably want to update this if you're monitoring a room that
        // has many underpowered homeservers.
        numberOfLaggingFederatedHomeserversExitWarningZone: new NumberProtectionSetting(DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_EXIT_WARNING_ZONE),
    };
    constructor() {
        super();
        // FIXME: Once in a while, cleanup!
    }
    public get name(): string {
        return 'DetectFederationLag';
    }
    public get description(): string {
        return `Warn moderators if either the local homeserver starts lagging by ${this.settings.localHomeserverLagEnterWarningZone.value}ms or at least ${this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value} start lagging by at least ${this.settings.federatedHomeserverLagEnterWarningZone.value}ms.`;
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        // First, handle all cases in which we should ignore the event.
        // FIXME: We should probably entirely ignore it until first /sync is complete.
        if (this.settings.ignoreRooms.value.has(roomId)) {
            // Room is ignored.
            return;
        }
        let sender = event['sender'] as string;
        if (typeof sender != "string") {
            // Ill-formed event.
            return;
        }
        if (sender == await mjolnir.client.getUserId()) {
            // Let's not create loops.
            return;
        }
        let domain = new UserID(sender).domain;
        if (!domain) {
            // Ill-formed event.
            return;
        }

        let now = new Date();
        let origin = event['origin_server_ts'] as number;
        if (typeof origin != "number") {
            // Ill-formed event.
            return;
        }
        let delay = now.getTime() - origin;
        if (delay < 0) {
            // Could be an ill-formed event.
            // Could be non-motonic clocks or other time shennanigans.
            return;
        }

        let roomStats = this.lagPerRoom.get(roomId);
        if (!roomStats) {
            roomStats = new RoomStats();
            this.lagPerRoom.set(roomId, roomStats);
        }

        const histogramSettings = Object.freeze({
            bucketNumber: this.settings.bucketNumber.value,
            bucketDurationMS: this.settings.bucketDurationMS.value
        });
        const localDomain = new UserID(await mjolnir.client.getUserId()).domain
        const isLocalDomain = domain == localDomain;
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

        roomStats.addLag(domain, delay, histogramSettings, thresholds, now);

        if (roomStats.latestWarning.getTime() + this.settings.warnAgainAfterMS.value > now.getTime()) {
            // No need to check for alarms, we have raised an alarm recently.
            // FIXME: There may be cases in which we want to re-raise an alarm, e.g.
            // if the local domain wasn't on alarm and now is.
            return;
        }

        // Check whether an alarm needs to be raised!
        let isLocalDomainOnAlert = roomStats.isServerOnAlert(localDomain);
        if (roomStats.alerts > this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value
            || isLocalDomainOnAlert)
        {
            // Raise the alarm!
            if (!roomStats.latestAlertStart) {
                roomStats.latestAlertStart = now;
            }
            roomStats.latestAlertStart = now;
            // Background-send message.
            let stats = roomStats.histogram.stats();
            logMessage(LogLevel.WARN, "FederationLag",
                `Room ${roomId} is experiencing ${ isLocalDomainOnAlert ? "LOCAL" : "federated" } lag since ${roomStats.latestAlertStart}.\nHomeservers displaying lag: ${roomStats.alerts}. Room: ${JSON.stringify(stats, null, 2)}.`);
            // Drop a state event, for the use of potential other bots.
            let warnStateEventId = await mjolnir.client.sendStateEvent(mjolnir.managementRoomId, "org.mjolnir.monitoring.lag", roomId, {
                domain,
                roomId,
                stats,
                since: roomStats.latestAlertStart,
            });
            roomStats.warnStateEventId = warnStateEventId;
        } else if (roomStats.alerts < this.settings.numberOfLaggingFederatedHomeserversExitWarningZone.value
            || !isLocalDomainOnAlert)
        {
            // Stop the alarm!
            logMessage(LogLevel.INFO, "FederationLag",
                `Room ${roomId} lag has decreased to an acceptable level. Currently, ${roomStats.alerts} homeservers are still lagging`
            );
            if (roomStats.warnStateEventId) {
                let warnStateEventId = roomStats.warnStateEventId;
                roomStats.warnStateEventId = null;
                mjolnir.client.redactEvent(mjolnir.managementRoomId, warnStateEventId, "Alert over");
            }
        }
    }
}
