/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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

import { LogService } from "@vector-im/matrix-bot-sdk";

export class PolicyservClient {
    public readonly baseUrl: string;
    private apiKey: string;

    constructor(baseUrl: string, apiKey: string) {
        LogService.info("PolicyservClient", "Setting up policyserv client");
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }

    public async checkEventId(eventId: string): Promise<boolean> {
        const url = `${this.baseUrl}/_policyserv/v1/check/event_id`;
        const response = await fetch(url, {
            method: "POST",
            body: JSON.stringify({ event_id: eventId }),
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        });
        return response.ok;
    }

    public async addRoom(roomId: string): Promise<void> {
        const url = `${this.baseUrl}/_policyserv/v1/join/${encodeURIComponent(roomId)}`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        });
        if (!response.ok) {
            if (response.status === 400) {
                // policyserv uses a 400 Bad Request to indicate the room is already joined, so we can ignore that error
                return;
            }
            throw new Error(`Failed to add room: ${response.statusText}`);
        }
    }
}
