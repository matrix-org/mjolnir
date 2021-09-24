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
    MemoryStorageProvider
} from "matrix-bot-sdk";
import config from "../../src/config";
import * as path from 'path';
import * as fs from 'fs/promises';
import { setupMjolnir } from '../../src/setup';
import { registerUser } from "./clientHelper";

/**
 * Ensures that a room exists with the alias, if it does not exist we create it.
 * @param client The MatrixClient to use to resolve or create the aliased room.
 * @param alias The alias of the room.
 * @returns The room ID of the aliased room.
 */
export async function ensureAliasedRoomExists(client: MatrixClient, alias: string): Promise<string> {
    return await client.resolveRoom(alias)
    .catch(async e => {
        if (e?.body?.errcode === 'M_NOT_FOUND') {
            console.info(`${alias} hasn't been created yet, so we're making it now.`)
            let roomId = await client.createRoom();
            await client.createRoomAlias(config.managementRoom, roomId);
            return roomId
        }
        throw e;
    });
}

async function configureMjolnir() {
    await fs.copyFile(path.join(__dirname, 'config', 'harness.yaml'), path.join(__dirname, '../../config/harness.yaml'));
    await registerUser('mjolnir', 'mjolnir', 'mjolnir', true).catch(e => {
        if (e.isAxiosError && e.response.data.errcode === 'M_USER_IN_USE') {
            console.log('mjolnir already registered, skipping');
        } else {
            throw e;
        }
    });
}


export async function makeMjolnir() {
    await configureMjolnir();
    console.info('starting mjolnir');
    const pantalaimon = new PantalaimonClient(config.homeserverUrl, new MemoryStorageProvider());
    const client = await pantalaimon.createClientWithCredentials(config.pantalaimon.username, config.pantalaimon.password);
    await ensureAliasedRoomExists(client, config.managementRoom);
    return await setupMjolnir(client, config);
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
