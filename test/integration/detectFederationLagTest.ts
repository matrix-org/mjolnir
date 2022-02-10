import { strict as assert } from "assert";

import { UserID } from "matrix-bot-sdk";
import { Suite } from "mocha";
import { Mjolnir } from "../../src/Mjolnir";
import { DetectFederationLag, LAG_STATE_EVENT } from "../../src/protections/DetectFederationLag";

const LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS = 180_000;
const LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS = 100_000;
const FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS = 300_000;
const FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS = 200_000;
const BUCKET_DURATION_MS = 100;
const SAMPLE_SIZE = 100;
const NUMBER_OF_LAGGING_FEDERATED_HOMESERVERS_ENTER_WARNING_ZONE = 2;

describe("Test: DetectFederationLag protection", function() {
    // In this entire test, we call `handleEvent` directly, injecting
    // - events that simulate lag;
    // - a progression through time, to make sure that histograms get processed.
    beforeEach(async function() {
        // Setup an instance of DetectFederationLag
        this.detector = new DetectFederationLag();
        await this.mjolnir.registerProtection(this.detector);
        await this.mjolnir.enableProtection("DetectFederationLag");

        const SETTINGS = {
            // The protection should kick in immediately.
            initialDelayGraceMS: 0,
            // Make histograms progress quickly.
            bucketDurationMS: BUCKET_DURATION_MS,
            // Three homeservers should be sufficient to raise an alert.
            numberOfLaggingFederatedHomeserversEnterWarningZone: NUMBER_OF_LAGGING_FEDERATED_HOMESERVERS_ENTER_WARNING_ZONE,

            localHomeserverLagEnterWarningZoneMS: LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS,
            localHomeserverLagExitWarningZoneMS: LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS,

            federatedHomeserverLagEnterWarningZoneMS: FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS,
            federatedHomeserverLagExitWarningZoneMS: FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS,
        };
        for (let key of Object.keys(SETTINGS)) {
            this.detector.settings[key].setValue(SETTINGS[key]);
        }
        this.localDomain = new UserID(await this.mjolnir.client.getUserId()).domain;
        this.protectedRoomId = `!room1:${this.localDomain}`;
        console.debug("YORIC", "local domain", this.localDomain);

        this.simulateLag = async (senders: string[], lag: number, start: Date = new Date()) => {
            console.debug("YORIC", "Simulating lag from", senders, "during interval", simulateDate(start, 0), simulateDate(start));
            const content = {};
            const origin_server_ts = start.getTime() - lag;
            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                // We call directly `this.detector.handleEvent` to be able to forge old values of `origin_server_ts`.
                await this.detector.handleEvent(this.mjolnir, this.protectedRoomId, {
                    sender: senders[i % senders.length],
                    origin_server_ts,
                    content,
                },
                    // Make sure that time progresses through histogram buckets.
                    simulateDate(start, i)
                );
            }
        };

        this.getAlertEvent = async () => {
            try {
                let event = await this.mjolnir.client.getRoomStateEvent(this.mjolnir.managementRoomId, LAG_STATE_EVENT, this.protectedRoomId);
                if (Object.keys(event).length == 0) {
                    // Event was redacted.
                    return null;
                }
                return event;
            } catch (ex) {
                // No such event.
                return null;
            }
        };
    })

    afterEach(async function() {
        await this.detector.cleanup();
        this.detector.dispose();
    });

    let simulateDate = (start: Date, progress: number = SAMPLE_SIZE) =>
        new Date(start.getTime() + 2 * progress * BUCKET_DURATION_MS / SAMPLE_SIZE);

    it('DetectFederationLag doesn\'t detect lag when there isn\'t any', async function() {
        this.timeout(60000);
        // In this test, all the events we send have a lag < {local, federated}HomeserverLagEnterWarningZoneMS.

        // Ensure that no alert has been emitted yet.
        assert.equal(await this.getAlertEvent(), null, "Initially, there should be no alert");

        // First, let's send events from the local homeserver.
        const LOCAL_SENDERS = [`@local_user:${this.localDomain}`];
        for (let multiplier of [0, 0.5, 0.9]) {
            const LAG = multiplier * LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS;
            await this.simulateLag(LOCAL_SENDERS, LAG);
            assert.equal(await this.getAlertEvent(), null, `We have sent lots of local pseudo-events with a small lag of ${LAG}, there should be NO alert`);
        }

        // Three distinct remote servers should be sufficient to trigger an alert, if they all lag.
        const REMOTE_SENDERS = [
            "@user2:left.example.com",
            "@user3:right.example.com",
            "@user4:middle.example.com",
        ];
        for (let multiplier of [0, 0.5, 0.9]) {
            const LAG = multiplier * FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS;
            await this.simulateLag(REMOTE_SENDERS, LAG);
            assert.equal(await this.getAlertEvent(), null, `We have sent lots of remote pseudo-events with a small lag of ${LAG}, there should be NO alert`);
        }
    });

    it('DetectFederationLag detects lag on local homeserver', async function() {
        this.timeout(60000);
        // In this test, all the events we send have a lag > localHomeserverLagEnterWarningZoneMS.
        const start = new Date();
        const stop = simulateDate(start);

        // Ensure that no alert has been emitted yet.
        assert.equal(await this.getAlertEvent(), null, "Initially, there should be no alert");

        // Simulate lagging events from the local homeserver. This should trigger an alarm.
        const SENDERS = [`@local_user_1:${this.localDomain}`];
        await this.simulateLag(SENDERS, 1.5 * LOCAL_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS);

        let lagEvent = await this.getAlertEvent();
        console.debug(lagEvent);

        assert(lagEvent, "Local lag should be reported");
        assert.equal(JSON.stringify(lagEvent.domains), JSON.stringify([this.localDomain]), "Lag report should mention only the local domain");
        assert.equal(lagEvent.roomId, this.protectedRoomId, "Lag report should mention the right room");
        assert(new Date(lagEvent.since) >= start, "Lag report should have happened since `now`");
        assert(new Date(lagEvent.since) < stop, "Lag should have been detected before the end of the bombardment");

        // Simulate non-lagging events from the local homeserver. After a while, this should rescind the alarm.
        // We switch to a new (pseudo-)user to simplify reading logs.
        const SENDERS_2 = [`@local_user_2:${this.localDomain}`];
        const start2 = new Date(stop.getTime() + 1_000);
        await this.simulateLag(SENDERS_2, 0.75 * LOCAL_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS, start2);

        assert.equal(await this.getAlertEvent(), null, "The alert should now be rescinded");
    });

    it('DetectFederationLag doesn\'t report lag when only one federated homeserver lags', async function() {
        this.timeout(60000);
        // In this test, all the events we send have a lag > federatedHomeserverLagEnterWarningZoneMS.
        const start = new Date();

        // Ensure that no alert has been emitted yet.
        assert.equal(await this.getAlertEvent(), null, "Initially, there should be no alert");

        // First, let's send events from the local homeserver.
        const SENDERS = ["@left:left.example.com"];
        await this.simulateLag(SENDERS, 1.5 * FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS);

        let lagEvent = await this.getAlertEvent();
        assert.equal(lagEvent, null, "With only one federated homeserver lagging, we shouldn't report any lag");
    });

    it('DetectFederationLag reports lag when three federated homeservers lag', async function() {
        this.timeout(60000);
        // In this test, all the events we send have a lag > federatedHomeserverLagEnterWarningZoneMS.
        const start = new Date();
        const stop = simulateDate(start);

        // Ensure that no alert has been emitted yet.
        assert.equal(await this.getAlertEvent(), null, "Initially, there should be no alert");

        // Simulate lagging events from remote homeservers. This should trigger an alarm.
        const SENDERS = [
            "@left:left.example.com",
            "@middle:middle.example.com",
            "@right:right.example.com",
        ];
        await this.simulateLag(SENDERS, 1.5 * FEDERATED_HOMESERVER_LAG_ENTER_WARNING_ZONE_MS);

        let lagEvent = await this.getAlertEvent();
        console.debug(lagEvent);
        assert(lagEvent, "Local lag should be reported");
        assert.equal(JSON.stringify(lagEvent.domains.sort()), JSON.stringify(["left.example.com", "middle.example.com", "right.example.com"]), "Lag report should mention only the local domain");
        assert.equal(lagEvent.roomId, this.protectedRoomId, "Lag report should mention the right room");
        assert(new Date(lagEvent.since) >= start, "Lag report should have happened since `now`");
        assert(new Date(lagEvent.since) < stop, "Lag should have been detected before the end of the bombardment");

        // Simulate non-lagging events from remote homeservers. After a while, this should rescind the alarm.
        // We switch to new (pseudo-)users to simplify reading logs.
        const SENDERS_2 = [
            "@left_2:left.example.com",
            "@middle_2:middle.example.com",
            "@right_2:right.example.com",
        ];
        const start2 = new Date(stop.getTime() + 1_000);
        await this.simulateLag(SENDERS_2, 0.75 * FEDERATED_HOMESERVER_LAG_EXIT_WARNING_ZONE_MS, start2);

        assert.equal(await this.getAlertEvent(), null, "The alert should now be rescinded");
    });
});
