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
import { LogLevel, LogService, StateEvent, UserID } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import config from "../config";

const DEFAULT_BUCKET_DURATION_MS = 10_000;
const DEFAULT_BUCKET_NUMBER = 6;


export const ENTER_LAG_THRESHOLD_MS = 20000;
export const LEAVE_LAG_THRESHOLD_MS = 15000;
export const REPEAT_AFTER_MS = 10 * 60 * 1000; // 10 minutes
export const WARN_AFTER_MS = 30 * 1000; // 30 seconds

class TimedHistogram<T> {
    // An array of length <= `numberOfColumns`
    protected buckets: {
        timeStamp: number;
        entries: T[]
    }[];
    private _latestUpdate: Date;

    constructor(public readonly settings: HistogramSettings, now: Date = new Date()) {
        this.buckets = []
        this._latestUpdate = now;
    }
    get length(): number {
        return this.buckets.length;
    }
    push(value: T, now: Date = new Date()) {
        this._latestUpdate = now;
        let timeStamp = now.getTime();
        let latestEntry = this.buckets[this.buckets.length - 1];
        if (latestEntry && latestEntry.timeStamp + this.settings.bucketDurationMS >= timeStamp) {
            // We're still within `durationPerColumnMS` of latest entry, we can reuse that entry.
            latestEntry.entries.push(value);
            return;
        }
        // Otherwise, initialize an entry, then prune columns that are too old.
        this.buckets.push({
            timeStamp,
            entries: [value]
        });
        const oldestAcceptableTimestamp = timeStamp - this.settings.bucketDurationMS * this.settings.bucketNumber;
        for (let i = this.buckets.length - 2; i >=0; --i) {
            // Find the most recent bucket that is too old.
            if (this.buckets[i].timeStamp < oldestAcceptableTimestamp) {
                // ...and remove that bucket and every bucket before it.
                this.buckets.splice(0, i + 1);
                break;
            }
        }
    }
    get latestUpdate() {
        return this._latestUpdate;
    }
}

type Stats = {
    min: number,
    max: number,
    mean: number,
    median: number,
    stddev: number,
    length: number,
}

class NumbersTimedHistogram extends TimedHistogram<number> {
    private _latestStatsUpdate: Date;
    constructor(settings: HistogramSettings, now = new Date()) {
        super(settings, now);
        this._latestStatsUpdate = now;
    }
    public get latestStatsUpdate() {
        return this._latestStatsUpdate;
    }
    public stats(now: Date = new Date()): Stats|null {
        this._latestStatsUpdate = now;
        if (this.buckets.length == 0) {
            return null;
        }
        let numbers = [];
        for (let bucket of this.buckets) {
            numbers.push(...bucket.entries);
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

type HistogramSettings = {
    bucketDurationMS: number,
    bucketNumber: number;
}

class ServerInfo {
    public histogram: NumbersTimedHistogram;
    public alertingSince: Date | null = null;
    public latestWarning: Date = new Date(0);
    public warnStateEventId: string | null = null;
    public latestMessage: Date = new Date(0);
    constructor(settings: HistogramSettings, now: Date = new Date()) {
        this.histogram = new NumbersTimedHistogram(settings, now);
    }
    addLag(lag: number, now: Date = new Date()) {
        this.latestMessage = now;
        this.histogram.push(lag, now);
    }
}

/**
 * Statistics to help determine whether we should raise the alarm on lag in a room.
 * 
 * Each individual server may have lag.
 */
class RoomStats {
    _latestStatsUpdate: Date;
    constructor() {
        this.serverLags = new Map();
        this.totalLag = new ServerInfo({
            bucketDurationMS: DEFAULT_BUCKET_DURATION_MS,
            bucketNumber: DEFAULT_BUCKET_NUMBER
        });
    }
    private serverLags: Map<string /* domain */, ServerInfo> = new Map();
    public totalLag: ServerInfo;

    /**
     * Add a lag annotation.
     *
     * @param serverId The server from which the message was sent. Could be the local server.
     * @param lag How many ms of lag was measured. Hopefully ~0.
     * @param settings Settings used in case we need to create or update the histogram.
     * @param now Instant at which all of this was measured.
     * @returns The histogram just updated.
     */
    addLag(serverId: string, lag: number, settings: HistogramSettings, now: Date = new Date()): ServerInfo {
        // Update per-server lag.
        let serverInfo = this.serverLags.get(serverId);
        if (!serverInfo) {
            serverInfo = new ServerInfo(settings);
            this.serverLags.set(serverId, serverInfo);
        } else {
            serverInfo.histogram.updateSettings(settings);
        }
        serverInfo.addLag(lag, now);

        // Update global lag.
        this.totalLag.histogram.updateSettings(settings);
        this.totalLag.addLag(lag, now);

        return serverInfo;
    }
}

class OngoingAlert {
    private perServer: Map<string /*serverId*/, ServerInfo> = new Map();
    private _alertStart: Date|null = null;
    public latestWarning: Date = new Date(0);
    public addServer(serverId: string, serverInfo: ServerInfo) {
        this.perServer.set(serverId, serverInfo);
    }
    public removeServer(serverId: string) {
        this.perServer.delete(serverId);
    }
    public getServer(serverId: string): ServerInfo | undefined {
        return this.perServer.get(serverId);
    }
    public get size(): number {
        return this.perServer.size;
    }
    public enterAlert(now: Date = new Date()): Date {
        if (!this._alertStart) {
            this._alertStart = now;
        }
        return this._alertStart;
    }
    public exitAlert() {
        this._alertStart = null;
    }

}

export class DetectFederationLag extends Protection {
    laggingRooms: Map<string /* roomId */, RoomStats> = new Map();
    ongoingAlerts: Map<string /* roomId */, OngoingAlert> = new Map();
    settings = {
        // Rooms to ignore.
        ignoreRooms: new StringSetProtectionSetting(),
        // Servers to ignore, typically because they're known to be slow.
        ignoreServers: new StringSetProtectionSetting(),
        bucketDurationMS: new NumberProtectionSetting(DEFAULT_BUCKET_DURATION_MS),
        bucketNumber: new NumberProtectionSetting(DEFAULT_BUCKET_NUMBER),
        // How much lag before the local homeserver is considered lagging.
        localHomeserverLagEnterWarningZone: new NumberProtectionSetting(DEFAULT_ENTER_WARNING_ZONE_LOCAL_SERVER_MS),
        localHomeserverLagExitWarningZone: new NumberProtectionSetting(DEFAULT_EXIT_WARNING_ZONE_LOCAL_SERVER_MS),
        // How much lag before a federated homeserver is considered lagging.
        federatedHomeserverLagEnterWarningZone: new NumberProtectionSetting(DEFAULT_ENTER_WARNING_ZONE_FEDERATED_SERVER_MS),
        federatedHomeserverLagExitWarningZone: new NumberProtectionSetting(DEFAULT_EXIT_WARNING_ZONE_FEDERATED_SERVER_MS),
        // How often we should print warnings.
        warnAgainAfterMS: new NumberProtectionSetting(DEFAULT_REWARN_AFTER_MS),
        // How many federated homeservers it takes to trigger an alert.
        numberOfLaggingFederatedHomeserversEnterWarningZone: new NumberProtectionSetting(DEFAULT_NUMBER_OF_LAGGING_FEDERATED_SERVERS_ENTER_WARNING_ZONE),
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
        return `Warn moderators if the lag exceeds ${ENTER_LAG_THRESHOLD_MS}ms (customizable).`;
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

        // 
        let roomStats = this.laggingRooms.get(roomId);
        if (!roomStats) {
            roomStats = new RoomStats();
            this.laggingRooms.set(roomId, roomStats);
        }

        const histogramSettings = Object.freeze({
            bucketNumber: this.settings.bucketNumber.value,
            bucketDurationMS: this.settings.bucketDurationMS.value
        });
        const serverInfo = roomStats.addLag(domain, delay, histogramSettings, now);

        if (serverInfo.histogram.latestStatsUpdate.getTime() + this.settings.bucketDurationMS.value > now.getTime()) {
            // Nothing else to do.
            return;
        }

        // Time to update stats!
        const stats = serverInfo.histogram.stats(now)!;

        // Determine if alarm needs to be started/stopped.
        const localDomain = new UserID(await mjolnir.client.getUserId()).domain
        const isLocalDomain = domain == localDomain;
        const { enterWarningZone, exitWarningZone } =
            isLocalDomain
            ? {
                enterWarningZone: this.settings.localHomeserverLagEnterWarningZone.value,
                exitWarningZone: this.settings.localHomeserverLagExitWarningZone.value,
            }
            : {
                enterWarningZone: this.settings.federatedHomeserverLagEnterWarningZone.value,
                exitWarningZone: this.settings.federatedHomeserverLagExitWarningZone.value,
            };
        //const lagStateKey = domain;
        if (stats.median > enterWarningZone) {
            // Oops, we *are* lagging.
            // Determine whether we need to start warning/re-warn.
            if (!serverInfo.alertingSince) {
                serverInfo.alertingSince = now;
            }
/*
                // Drop a state event so that other bots could do something about it, e.g.
                // if someone wants to plug a pager to Mjölnir.
                let warnStateEventId = await mjolnir.client.sendStateEvent(mjolnir.managementRoomId, "org.mjolnir.monitoring.lag", lagStateKey, {
                    domain,
                    roomId,
                    stats,
                    since: serverInfo.alertingSince,
                });
                serverInfo.warnStateEventId = warnStateEventId;
                // FIXME: This is going to send *many* messages if we are currently experiencing federation issue.
                logMessage(LogLevel.WARN, "FederationLag",
                    `Room ${roomId} is experiencing a median lag of ${stats.median}ms from ${isLocalDomain ? "LOCAL" : "federated"} homeserverserver ${domain}, first detected at ${serverInfo.alertingSince}`);
*/
                let alert = this.getOngoingAlert(roomId);
                alert.addServer(domain, serverInfo);
                let isLocalDomainHit = alert.getServer(domain);
                if (alert.size > this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value
                    || isLocalDomainHit) {
                    // We have reached the threshold at which we need to start (or continue) the alarm.
                    let start = alert.enterAlert(now);
                    let roomTotalStats = roomStats.totalLag.histogram.stats();
                    if (alert.latestWarning.getTime() + this.settings.warnAgainAfterMS.value < now.getTime()) {
                        logMessage(LogLevel.WARN, "FederationLag",
                            `Room ${roomId} is experiencing ${ isLocalDomainHit ? "LOCAL" : "federated" } lag since ${start}.\nHomeservers displaying lag: ${alert.size}. Room: ${JSON.stringify(roomTotalStats, null, 2)}.`);
                    }
                    // FIXME: Raise the alarm!
            }
        } else if (stats.mean < exitWarningZone) {
            // We are not lagging. If we have just stopped lagging, this deserves a notice.
            if (serverInfo.alertingSince) {
                serverInfo.alertingSince = null;
            }
/*
            // FIXME: This is going to send *many* messages if we are currently experiencing federation issue.
                logMessage(LogLevel.INFO, "FederationLag",
                    `Room ${roomId} median lag has decreased to ${stats.median}ms from ${isLocalDomain ? "LOCAL" : "federated"} homeserverserver ${domain}, stopping alert started at ${serverInfo.alertingSince}`);
            }
*/
            let alert = this.getOngoingAlert(roomId);
            alert.addServer(domain, serverInfo);
            if (alert.size < this.settings.numberOfLaggingFederatedHomeserversEnterWarningZone.value
                && !alert.getServer(domain)) {
                // FIXME: Stop the alarm.
            }

            this.ongoingAlerts.get(roomId)?.removeServer(domain);
/*
            if (serverInfo.warnStateEventId) {
                await mjolnir.client.redactEvent(mjolnir.managementRoomId, serverInfo.warnStateEventId, "Crisis over");
                serverInfo.warnStateEventId = null;
            }
*/
        }
    }
    private getOngoingAlert(roomId: string): OngoingAlert {

    }
}
