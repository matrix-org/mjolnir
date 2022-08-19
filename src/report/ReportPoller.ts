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

import { Mjolnir, REPORT_POLL_EVENT_TYPE } from "../Mjolnir";
import { ReportManager } from './ReportManager';
import { LogLevel } from "matrix-bot-sdk";

class InvalidStateError extends Error { }

/**
 * A class to poll synapse's report endpoint, so we can act on new reports
 *
 * @param mjolnir The running Mjolnir instance
 * @param manager The report manager in to which we feed new reports
 */
export class ReportPoller {
    /**
     * https://matrix-org.github.io/synapse/latest/admin_api/event_reports.html
     * "from" is an opaque token that is returned from the API to paginate reports
     */
    private from: number | null = null;
    /**
     * The currently-pending report poll
     */
    private timeout: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private mjolnir: Mjolnir,
        private manager: ReportManager,
    ) { }

    private schedulePoll() {
        if (this.timeout === null) {
            /*
             * Important that we use `setTimeout` here, not `setInterval`,
             * because if there's networking problems and `getAbuseReports`
             * hangs for longer thank the interval, it could cause a stampede
             * of requests when networking problems resolve
             */
            this.timeout = setTimeout(
                this.tryGetAbuseReports.bind(this),
                30_000 // a minute in milliseconds
            );
        } else {
            throw new InvalidStateError("poll already scheduled");
        }
    }

    private async getAbuseReports() {
        let params: { dir: string, from?: number} = {
            // short for direction: forward; i.e. show newest last
            dir: "f",
        }
        if (this.from !== null) {
            params["from"] = this.from;
        }

        let response_: {
            event_reports: { room_id: string, event_id: string, sender: string, reason: string }[],
            next_token: number | undefined,
            total: number,
        } | undefined;
        try {
            response_ = await this.mjolnir.client.doRequest(
                "GET",
                "/_synapse/admin/v1/event_reports",
                params,
            );
        } catch (ex) {
            await this.mjolnir.logMessage(LogLevel.ERROR, "getAbuseReports", `failed to poll events: ${ex}`);
            return;
        }

        const response = response_!;

        for (let report of response.event_reports) {
            if (!(report.room_id in this.mjolnir.protectedRooms)) {
                continue;
            }

            let event: any; // `any` because `handleServerAbuseReport` uses `any`
            try {
                event = (await this.mjolnir.client.doRequest(
                    "GET",
                    `/_synapse/admin/v1/rooms/${report.room_id}/context/${report.event_id}?limit=1`
                )).event;
            } catch (ex) {
                this.mjolnir.logMessage(LogLevel.ERROR, "getAbuseReports", `failed to get context: ${ex}`);
                continue;
            }

            await this.manager.handleServerAbuseReport({
                roomId: report.room_id,
                reporterId: report.sender,
                event: event,
                reason: report.reason,
            });
        }

        let from;
        if (this.from === null) {
            /*
             * If this is our first call to this endpoint, we want to skip to
             * the end of available reports, so we'll only consider reports
             * that happened after we supported report polling.
             */
            from = response.total;
        } else {
            /*
             * If there are more pages for us to read, this endpoint will
             * return an opaque `next_token` number that we want to provide
             * on the next endpoint call. If not, we're on the last page,
             * which means we want to skip to the end of this page.
             */
            from = response.next_token ?? this.from + response.event_reports.length;
        }

        this.from = from;
        try {
            await this.mjolnir.client.setAccountData(REPORT_POLL_EVENT_TYPE, { from: from });
        } catch (ex) {
            await this.mjolnir.logMessage(LogLevel.ERROR, "getAbuseReports", `failed to update progress: ${ex}`);
        }
    }

    private async tryGetAbuseReports() {
        this.timeout = null;

        try {
            await this.getAbuseReports()
        } catch (ex) {
            await this.mjolnir.logMessage(LogLevel.ERROR, "tryGetAbuseReports", `failed to get abuse reports: ${ex}`);
        }

        this.schedulePoll();
    }
    public start(startFrom: number) {
        if (this.timeout === null) {
            this.from = startFrom;
            this.schedulePoll();
        } else {
            throw new InvalidStateError("cannot start an already started poll");
        }
    }
    public stop() {
        if (this.timeout !== null) {
            clearTimeout(this.timeout);
            this.timeout = null;
        } else {
            throw new InvalidStateError("cannot stop a poll that hasn't started");
        }
    }
}
