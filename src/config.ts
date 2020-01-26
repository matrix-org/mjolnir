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

import * as config from "config";
import { MatrixClient } from "matrix-bot-sdk";

interface IConfig {
    homeserverUrl: string;
    accessToken: string;
    pantalaimon: {
        use: boolean;
        username: string;
        password: string;
    };
    dataPath: string;
    autojoin: boolean;
    autojoinOnlyIfManager: boolean;
    managementRoom: string;
    verboseLogging: boolean;
    logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
    syncOnStartup: boolean;
    verifyPermissionsOnStartup: boolean;
    noop: boolean;
    protectedRooms: string[]; // matrix.to urls
    fasterMembershipChecks: boolean;
    automaticallyRedactForReasons: string[]; // case-insensitive globs
    protectAllJoinedRooms: boolean;
    banListServer: {
        enabled: boolean;
        bind: string;
        port: number;
    };

    /**
     * Config options only set at runtime. Try to avoid using the objects
     * here as much as possible.
     */
    RUNTIME: {
        client: MatrixClient;
    };
}

export default <IConfig>config;
