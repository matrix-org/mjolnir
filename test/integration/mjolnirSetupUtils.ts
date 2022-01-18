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
    PantalaimonClient,
    MemoryStorageProvider,
    LogService,
    LogLevel,
    RichConsoleLogger,
    RustSdkCryptoStorageProvider
} from "matrix-bot-sdk";
import { Mjolnir }  from '../../src/Mjolnir';
import config from "../../src/config";
import { getTempCryptoStore, registerUser } from "./clientHelper";
import { patchMatrixClient } from "../../src/utils";
import { promises as fs } from "fs";

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
        if (e?.body?.errcode === 'M_NOT_FOUND') {
            console.info(`${alias} hasn't been created yet, so we're making it now.`)
            let roomId = await client.createRoom({
                visibility: "public",
            });
            await client.createRoomAlias(alias, roomId);
            return roomId
        }
        throw e;
    }
}

async function configureMjolnir() {
    try {
        const { access_token } = await registerUser('mjolnir', 'mjolnir', 'mjolnir', true);
        return access_token;
    } catch (e) {
        if (e.isAxiosError) {
            console.log('Received error while registering', e.response.data || e.response);
            if (e.response.data && e.response.data.errcode === 'M_USER_IN_USE') {
                console.log('mjolnir already registered, skipping');
                // Needed for encryption tests
                return (await new MatrixClient(config.homeserverUrl, "").doRequest('POST', '/_matrix/client/r0/login', undefined, {
                    "type": "m.login.password",
                    "identifier": {
                      "type": "m.id.user",
                      "user": "mjolnir"
                    },
                    "password": "mjolnir"
                })).access_token;
            }
        }
        throw e;
    };
}

export function mjolnir(): Mjolnir | null {
    return globalMjolnir;
}
export function matrixClient(): MatrixClient | null {
    return globalClient;
}
let globalClient: MatrixClient | null
let globalMjolnir: Mjolnir | null;

/**
 * Return a test instance of Mjolnir.
 */
export async function makeMjolnir(): Promise<Mjolnir> {
    const accessToken = await configureMjolnir();
    LogService.setLogger(new RichConsoleLogger());
    LogService.setLevel(LogLevel.fromString(config.logLevel, LogLevel.DEBUG));
    LogService.info("test/mjolnirSetupUtils", "Starting bot...");
    let client: MatrixClient;
    if (config.pantalaimon.use) {
        const pantalaimon = new PantalaimonClient(config.homeserverUrl, new MemoryStorageProvider());
        client = await pantalaimon.createClientWithCredentials(config.pantalaimon.username, config.pantalaimon.password);
    } else {
        client = new MatrixClient(config.homeserverUrl, accessToken, new MemoryStorageProvider(), await getTempCryptoStore());
        client.crypto.prepare(await client.getJoinedRooms());
    }
    patchMatrixClient();
    await ensureAliasedRoomExists(client, config.managementRoom);
    let mjolnir = await Mjolnir.setupMjolnirFromConfig(client);
    globalClient = client;
    globalMjolnir = mjolnir;
    return mjolnir;
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