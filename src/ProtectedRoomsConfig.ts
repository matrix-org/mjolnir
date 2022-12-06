/*
Copyright 2019, 2022 The Matrix.org Foundation C.I.C.

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

import AwaitLock from 'await-lock';
import { extractRequestError, LogService, Permalinks } from "matrix-bot-sdk";
import { IConfig } from "./config";
import { MatrixSendClient } from './MatrixEmitter';
const PROTECTED_ROOMS_EVENT_TYPE = "org.matrix.mjolnir.protected_rooms";

/**
 * Manages the set of rooms that the user has EXPLICITLY asked to be protected.
 */
export default class ProtectedRoomsConfig {

    /**
     * These are rooms that we EXPLICITLY asked Mjolnir to protect, usually via the `rooms add` command.
     * These are NOT all of the rooms that mjolnir is protecting as with `config.protectAllJoinedRooms`.
     */
    private explicitlyProtectedRooms = new Set</*room id*/string>();
    /** This is to prevent clobbering the account data for the protected rooms if several rooms are explicitly protected concurrently. */
    private accountDataLock = new AwaitLock();

    constructor(private readonly client: MatrixSendClient) {

    }

    /**
     * Load any rooms that have been explicitly protected from a Mjolnir config.
     * Will also ensure we are able to join all of the rooms.
     * @param config The config to load the rooms from under `config.protectedRooms`.
     */
    public async loadProtectedRoomsFromConfig(config: IConfig): Promise<void> {
        // Ensure we're also joined to the rooms we're protecting
        LogService.info("ProtectedRoomsConfig", "Resolving protected rooms...");
        const joinedRooms = await this.client.getJoinedRooms();
        for (const roomRef of config.protectedRooms) {
            const permalink = Permalinks.parseUrl(roomRef);
            if (!permalink.roomIdOrAlias) continue;

            let roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
            if (!joinedRooms.includes(roomId)) {
                roomId = await this.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
            }
            this.explicitlyProtectedRooms.add(roomId);
        }
    }

    /**
     * Load any rooms that have been explicitly protected from the account data of the mjolnir user.
     * Will not ensure we can join all the rooms. This so mjolnir can continue to operate if bogus rooms have been persisted to the account data.
     */
    public async loadProtectedRoomsFromAccountData(): Promise<void> {
        LogService.debug("ProtectedRoomsConfig", "Loading protected rooms...");
        try {
            const data: { rooms?: string[] } | null = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
            if (data && data['rooms']) {
                for (const roomId of data['rooms']) {
                    this.explicitlyProtectedRooms.add(roomId);
                }
            }
        } catch (e) {
            if (e.statusCode === 404) {
                LogService.warn("ProtectedRoomsConfig", "Couldn't find any explicitly protected rooms from Mjolnir's account data, assuming first start.", extractRequestError(e));
            } else {
                throw e;
            }
        }
    }

    /**
     * Save the room as explicitly protected.
     * @param roomId The room to persist as explicitly protected.
     */
    public async addProtectedRoom(roomId: string): Promise<void> {
        this.explicitlyProtectedRooms.add(roomId);
        await this.saveProtectedRoomsToAccountData();
    }

    /**
     * Remove the room from the explicitly protected set of rooms.
     * @param roomId The room that should no longer be persisted as protected.
     */
    public async removeProtectedRoom(roomId: string): Promise<void> {
        this.explicitlyProtectedRooms.delete(roomId);
        await this.saveProtectedRoomsToAccountData([roomId]);
    }

    /**
     * Get the set of explicitly protected rooms.
     * This will NOT be the complete set of protected rooms, if `config.protectAllJoinedRooms` is true and should never be treated as the complete set.
     * @returns The rooms that are marked as explicitly protected in both the config and Mjolnir's account data.
     */
    public getExplicitlyProtectedRooms(): string[] {
        return [...this.explicitlyProtectedRooms.keys()]
    }

    /**
     * Persist the set of explicitly protected rooms to the client's account data.
     * @param excludeRooms Rooms that should not be persisted to the account data, and removed if already present.
     */
    private async saveProtectedRoomsToAccountData(excludeRooms: string[] = []): Promise<void> {
        // NOTE: this stops Mjolnir from racing with itself when saving the config
        //       but it doesn't stop a third party client on the same account racing with us instead.
        await this.accountDataLock.acquireAsync();
        try {
            const additionalProtectedRooms: string[] = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE)
                .then((rooms: {rooms?: string[]}) => Array.isArray(rooms?.rooms) ? rooms.rooms : [])
                .catch(e => (LogService.warn("ProtectedRoomsConfig", "Could not load protected rooms from account data", extractRequestError(e)), []));

            const roomsToSave = new Set([...this.explicitlyProtectedRooms.keys(), ...additionalProtectedRooms]);
            excludeRooms.forEach(roomsToSave.delete, roomsToSave);
            await this.client.setAccountData(PROTECTED_ROOMS_EVENT_TYPE, { rooms: Array.from(roomsToSave.keys()) });
        } finally {
            this.accountDataLock.release();
        }
    }
}
