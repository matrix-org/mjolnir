/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { MatrixEmitter, MatrixSendClient } from "./MatrixEmitter";
import { extractRequestError, LogService } from "@vector-im/matrix-bot-sdk";
import { getJoinedRoomMembersWithBackoff } from "./utils";

export class ModCache {
    private modRoomMembers: string[] = [];
    private ignoreList: string[] = [];
    private client: MatrixSendClient;
    private emitter: MatrixEmitter;
    private managementRoomId: string;
    private ttl: number = 1000 * 60 * 60; // 60 minutes
    private lastInvalidation = 0;
    private interval: any;

    /**
     * Log a cache refresh that failed, so it doesn't surface as an unhandled rejection.
     * The previous cache contents are kept, and `lastInvalidation` is left untouched so the
     * interval below retries within a minute.
     */
    private logPopulateFailure = (e: any) => {
        LogService.error("ModCache", `Failed to refresh the moderator cache: ${extractRequestError(e)}`);
    };

    constructor(client: MatrixSendClient, emitter: MatrixEmitter, managementRoomId: string) {
        this.client = client;
        this.emitter = emitter;
        this.managementRoomId = managementRoomId;
        this.init();
    }

    /**
     * Initially populate cache and set bot listening for membership events in moderation room
     */
    async init() {
        await this.populateCache().catch(this.logPopulateFailure);
        this.interval = setInterval(
            () => {
                if (Date.now() - this.lastInvalidation > this.ttl) {
                    this.populateCache().catch(this.logPopulateFailure);
                }
            },
            1000 * 60, // check invalidation status every minute
        );
        this.emitter.on("room.event", async (roomId: string, event: any) => {
            if (roomId === this.managementRoomId && event.type === "m.room.member") {
                await this.populateCache().catch(this.logPopulateFailure);
            }
        });
    }

    /**
     * Populate the cache by fetching moderation room members
     */
    public async populateCache() {
        const members = await getJoinedRoomMembersWithBackoff(this.client, this.managementRoomId);
        this.lastInvalidation = Date.now();

        this.modRoomMembers = [];
        members.forEach((member) => {
            if (!this.modRoomMembers.includes(member)) {
                this.modRoomMembers.push(member);
            }
            const server = member.split(":")[1];
            if (!this.modRoomMembers.includes(server)) {
                this.modRoomMembers.push(server);
            }
        });
    }

    /**
     * Check if a given entity is in cache
     */
    public checkMembership(entity: string) {
        return this.modRoomMembers.includes(entity) || this.ignoreList.includes(entity);
    }

    /**
     * Add a given entity to the list of users/servers who will not be banned but are not necessarily in moderator room
     */
    public addToIgnore(entity: string) {
        this.ignoreList.push(entity);
    }

    /**
     * Return a list of entities to ignore bans/ACLs for
     */
    public listIgnored() {
        return this.ignoreList;
    }

    /**
     * Return a list of both ignored entities and moderator room members
     */
    public listAll() {
        return this.ignoreList.concat(this.modRoomMembers);
    }

    /**
     * Clear the interval which refreshes cache
     */
    public stop() {
        clearInterval(this.interval);
    }
}
