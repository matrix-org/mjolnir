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
    private _client: MatrixClient;
    private _manager: ReportManager;
    private _save: (a: number) => Promise<any>;
    private _from = 0;

    private _interval: ReturnType<typeof setInterval> | null = null;

    constructor(
        client: MatrixClient,
        manager: ReportManager,
        save: (a: number) => Promise<any>
    ) {
        this._client = client;
        this._manager = manager;
        this._save = save;
    }

    private async getAbuseReports(): Promise<any> {
        const response = await this._client.doRequest(
            "GET",
            "/_synapse/admin/v1/event_reports",
            { from: this._from.toString() }
        );

        for (let report of response.event_reports) {
            const event = await this._client.getEvent(report.room_id, report.event_id);
            await this._manager.handleServerAbuseReport({
                roomId: report.room_id,
                reporterId: report.sender,
                event: event,
                reason: report.event,
            });
        }

        if (response.next_token !== undefined) {
            this._from = response.next_token;
            await this._save(response.next_token);
        }
    }

    public start(startFrom: number) {
        if (this._interval === null) {
            this._from = startFrom;
            const self = this;
            this._interval = setInterval(
                function() { self.getAbuseReports() },
                60_000
            );
        } else {
            throw new InvalidStateError();
        }
    }
    public stop() {
        if (this._interval !== null) {
            clearInterval(this._interval);
            this._interval = null;
        } else {
            throw new InvalidStateError();
        }
    }
}
