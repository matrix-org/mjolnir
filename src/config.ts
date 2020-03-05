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
    acceptInvitesFromGroup: string;
    autojoinOnlyIfManager: boolean;
    recordIgnoredInvites: boolean;
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
    commands: {
        allowNoPrefix: boolean;
        additionalPrefixes: string[];
    };

    /**
     * Config options only set at runtime. Try to avoid using the objects
     * here as much as possible.
     */
    RUNTIME: {
        client: MatrixClient;
    };
}

const defaultConfig: IConfig = {
    homeserverUrl: "http://localhost:8008",
    accessToken: "NONE_PROVIDED",
    pantalaimon: {
        use: false,
        username: "",
        password: "",
    },
    dataPath: "/data/storage",
    acceptInvitesFromGroup: '+example:example.org',
    autojoinOnlyIfManager: false,
    recordIgnoredInvites: false,
    managementRoom: "!noop:example.org",
    verboseLogging: false,
    logLevel: "INFO",
    syncOnStartup: true,
    verifyPermissionsOnStartup: true,
    noop: false,
    protectedRooms: [],
    fasterMembershipChecks: false,
    automaticallyRedactForReasons: ["spam", "advertising"],
    protectAllJoinedRooms: false,
    banListServer: {
        enabled: false,
        bind: "0.0.0.0",
        port: 5186,
    },
    commands: {
        allowNoPrefix: false,
        additionalPrefixes: [],
    },

    // Needed to make the interface happy.
    RUNTIME: {
        client: null,
    },
};

const finalConfig = <IConfig>Object.assign({}, defaultConfig, config);
export default finalConfig;
