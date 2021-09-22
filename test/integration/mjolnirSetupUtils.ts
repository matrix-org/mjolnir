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
    Permalinks,
    PantalaimonClient,
    MemoryStorageProvider
} from "matrix-bot-sdk";
import config from "../../src/config";
import * as HmacSHA1 from 'crypto-js/hmac-sha1';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs/promises';
import { setupMjolnir } from '../../src/setup';
import { registerUser } from "./clientHelper";

export async function createManagementRoom(client: MatrixClient) {
    let roomId = await client.createRoom();
    return await client.createRoomAlias(config.managementRoom, roomId);
}

export async function ensureManagementRoomExists(client: MatrixClient): Promise<string> {
    return await client.resolveRoom(config.managementRoom).catch(async e => {
        if (e?.body?.errcode === 'M_NOT_FOUND') {
            console.info("moderation room hasn't been created yet, so we're making it now.")
            return await createManagementRoom(client);
        }
        throw e;
    });
}

export async function ensureLobbyRoomExists(client: MatrixClient): Promise<string> {
    const alias = Permalinks.parseUrl(config.protectedRooms[0]).roomIdOrAlias;
    return await client.resolveRoom(alias).catch(async e => {
        if (e?.body?.errcode === 'M_NOT_FOUND') {
            console.info(`${alias} hasn't been created yet, so we're making it now.`)
            return await client.createRoomAlias(alias, await client.createRoom());
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

// it actually might make sense to give mjolnir a clean plate each time we setup and teardown a test.
// the only issues with this might be e.g. if we need to delete a community or something
// that mjolnir sets up each time, but tbh we should probably just avoid setting things like that and tearing it down.
// One thing that probably should not be persisted between tests is the management room, subscribed lists and protected rooms.
export async function makeMjolnir() {
    await configureMjolnir();
    console.info('starting mjolnir');
    const pantalaimon = new PantalaimonClient(config.homeserverUrl, new MemoryStorageProvider());
    const client = await pantalaimon.createClientWithCredentials(config.pantalaimon.username, config.pantalaimon.password);
    await ensureManagementRoomExists(client);
    return await setupMjolnir(client, config);
}