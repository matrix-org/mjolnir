/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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

import { MatrixClient, Permalinks } from "matrix-bot-sdk";

export default class BanList {
    private viaServers: string[] = [];

    constructor(private roomRef: string, private client: MatrixClient) {
        if (this.roomRef.startsWith("https")) {
            const parts = Permalinks.parseUrl(this.roomRef);
            this.roomRef = parts.roomIdOrAlias;

            if (parts.viaServers) this.viaServers = parts.viaServers;
        }

        client.resolveRoom(this.roomRef).then(roomId => this.roomRef = roomId);
    }

    public async ensureJoined(): Promise<void> {
        await this.client.joinRoom(this.roomRef, this.viaServers);
    }

    // TODO: Update list
    // TODO: Match checking

}
