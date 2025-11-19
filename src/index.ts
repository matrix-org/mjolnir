/*
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.

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

import * as path from "path";

import { Healthz } from "./health/healthz";

import {
    LogLevel,
    LogService,
    MatrixAuth,
    MatrixClient,
    PantalaimonClient,
    RichConsoleLogger,
    RustSdkCryptoStorageProvider,
    SimpleFsStorageProvider,
} from "@vector-im/matrix-bot-sdk";

import { read as configRead } from "./config";
import { Mjolnir } from "./Mjolnir";
import { initializeSentry, initializeGlobalPerformanceMetrics, patchMatrixClient } from "./utils";

(async function () {
    const config = configRead();

    config.RUNTIME = {};

    LogService.setLogger(new RichConsoleLogger());
    LogService.setLevel(LogLevel.fromString(config.logLevel, LogLevel.DEBUG));
    LogService.muteModule("MatrixClientLite");

    LogService.info("index", "Starting bot...");

    // Initialize error reporting as early as possible.
    if (config.health.sentry) {
        initializeSentry(config);
    }
    if (config.health.openMetrics?.enabled) {
        initializeGlobalPerformanceMetrics(config);
    }
    const healthz = new Healthz(config);
    healthz.isHealthy = false; // start off unhealthy
    if (config.health.healthz.enabled) {
        healthz.listen();
    }

    let bot: Mjolnir | null = null;
    try {
        const storagePath = path.isAbsolute(config.dataPath)
            ? config.dataPath
            : path.join(__dirname, "../", config.dataPath);
        const storage = new SimpleFsStorageProvider(path.join(storagePath, "bot.json"));
        const cryptoStorage = new RustSdkCryptoStorageProvider(storagePath, 0);

        if (config.encryption.use && config.pantalaimon.use) {
            throw Error("Cannot enable both pantalaimon and encryption at the same time. Remove one from the config.");
        }

        let client: MatrixClient;
        if (config.pantalaimon.use) {
            const pantalaimon = new PantalaimonClient(config.homeserverUrl, storage);
            client = await pantalaimon.createClientWithCredentials(
                config.pantalaimon.username,
                config.pantalaimon.password,
            );
        } else if (config.encryption.use) {
            const accessToken = await Promise.resolve(storage.readValue("access_token"));
            if (accessToken) {
                client = new MatrixClient(config.homeserverUrl, accessToken, storage, cryptoStorage);
            } else {
                LogService.info("index", "Access token not found, logging in.");
                const auth = new MatrixAuth(config.homeserverUrl);
                const tempClient = await auth.passwordLogin(config.encryption.username, config.encryption.password);
                storage.storeValue("access_token", tempClient.accessToken);
                client = new MatrixClient(config.homeserverUrl, tempClient.accessToken, storage, cryptoStorage);
            }
            try {
                LogService.info("index", "Preparing encrypted client...");
                await client.crypto.prepare();
            } catch (e) {
                LogService.error("Index", `Error preparing encrypted client ${e}`);
                throw e;
            }
        } else {
            client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);
        }
        patchMatrixClient();
        config.RUNTIME.client = client;

        bot = await Mjolnir.setupMjolnirFromConfig(client, client, config);
    } catch (err) {
        console.error(`Failed to setup mjolnir from the config ${config.dataPath}: ${err}`);
        throw err;
    }
    try {
        await bot.start();
        healthz.isHealthy = true;
    } catch (err) {
        console.error(`Mjolnir failed to start: ${err}`);
        throw err;
    }
})();
