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

import { MatrixClient } from "matrix-bot-sdk";
import { ReportManager } from './ReportManager';

class InvalidStateError extends Error {}

export class ReportPoll {
    private from = 0;
    private interval: ReturnType<typeof setInterval> | null = null;

    /*
     * A class to poll synapse's report endpoint, so we can act on new reports
     *
     * @param client The Matrix client underpinning the running Mjolnir
     * @param manager The report manager in to which we feed new reports
     * @param save An abstract function to persist where we got to in report reading
     */
    constructor(
        private client: MatrixClient,
        private manager: ReportManager,
        private save: (a: number) => Promise<any>
    ) { }

    private async getAbuseReports(): Promise<any> {
        const response = await this.client.doRequest(
            "GET",
            "/_synapse/admin/v1/event_reports",
            { from: this.from.toString() }
        );

        for (let report of response.event_reports) {
            const event = await this.client.getEvent(report.room_id, report.event_id);
            await this.manager.handleServerAbuseReport({
                roomId: report.room_id,
                reporterId: report.sender,
                event: event,
                reason: report.event,
            });
        }

        if (response.next_token !== undefined) {
            this.from = response.next_token;
            await this.save(response.next_token);
        }
    }

    public start(startFrom: number) {
        if (this.interval === null) {
            this.from = startFrom;
            const self = this;
            this.interval = setInterval(
                function() { self.getAbuseReports() },
                60_000 // a minute in milliseconds
            );
        } else {
            throw new InvalidStateError();
        }
    }
    public stop() {
        if (this.interval !== null) {
            clearInterval(this.interval);
            this.interval = null;
        } else {
            throw new InvalidStateError();
        }
    }
}
