/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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
import {
    MatrixClient,
    MemoryStorageProvider,
    LogService,
    LogLevel,
    RichConsoleLogger,
} from "@vector-im/matrix-bot-sdk";

import { Mjolnir } from "../../src/Mjolnir";
import { getTempCryptoStore, overrideRatelimitForUser, registerUser } from "./clientHelper";
import { initializeGlobalPerformanceMetrics, initializeSentry, patchMatrixClient } from "../../src/utils";
import { IConfig } from "../../src/config";

/**
 * Ensures that a room exists with the alias, if it does not exist we create it.
 * @param client The MatrixClient to use to resolve or create the aliased room.
 * @param alias The alias of the room.
 * @returns The room ID of the aliased room.
 */
export async function ensureAliasedRoomExists(client: MatrixClient, alias: string): Promise<string> {
    try {
        return await client.resolveRoom(alias);
    } catch (e) {
        if (e?.body?.errcode === "M_NOT_FOUND") {
            console.info(`${alias} hasn't been created yet, so we're making it now.`);
            let roomId = await client.createRoom({
                visibility: "public",
            });
            await client.createRoomAlias(alias, roomId);
            return roomId;
        }
        throw e;
    }
}

async function configureMjolnir(config: IConfig) {
    // Initialize error monitoring as early as possible.
    initializeSentry(config);
    initializeGlobalPerformanceMetrics(config);

    let accessToken = await registerUser(
        config.homeserverUrl,
        config.encryption.username,
        config.encryption.username,
        config.encryption.password,
        true,
    );

    return accessToken;
}

export function mjolnir(): Mjolnir | null {
    return globalMjolnir;
}
export function matrixClient(): MatrixClient | null {
    return globalClient;
}
let globalClient: MatrixClient | null;
let globalMjolnir: Mjolnir | null;

/**
 * Return a test instance of Mjolnir.
 */
export async function makeMjolnir(config: IConfig): Promise<Mjolnir> {
    let accessToken = await configureMjolnir(config);
    let cryptoStore = await getTempCryptoStore();
    LogService.setLogger(new RichConsoleLogger());
    LogService.setLevel(LogLevel.fromString(config.logLevel, LogLevel.DEBUG));
    LogService.info("test/mjolnirSetupUtils", "Starting bot...");
    LogService.muteModule("MatrixClientLite");
    let client = new MatrixClient(config.homeserverUrl, accessToken, new MemoryStorageProvider(), cryptoStore);
    await client.crypto.prepare();

    await overrideRatelimitForUser(config.homeserverUrl, await client.getUserId());
    patchMatrixClient();
    await ensureAliasedRoomExists(client, config.managementRoom);
    let mj = await Mjolnir.setupMjolnirFromConfig(client, client, config);
    globalClient = client;
    globalMjolnir = mj;
    return mj;
}

/**
 * Remove the alias and leave the room, can't be implicitly provided from the config because Mjolnir currently mutates it.
 * @param client The client to use to leave the room.
 * @param roomId The roomId of the room to leave.
 * @param alias The alias to remove from the room.
 */
export async function teardownManagementRoom(client: MatrixClient, roomId: string, alias: string) {
    await client.deleteRoomAlias(alias);
    await client.leaveRoom(roomId);
}
