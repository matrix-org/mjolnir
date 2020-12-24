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

export interface IBlock {
    users: boolean;
    rooms: boolean;
    servers: boolean;
}

export interface IRuleServerBlocks {
    messages: IBlock;
    invites: IBlock;
    usernames: IBlock;
    roomCreate: IBlock;
    makeAlias: IBlock;
    publishRoom: IBlock;
}

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
    commands: {
        allowNoPrefix: boolean;
        additionalPrefixes: string[];
    };
    protections: {
        wordlist: {
            words: string[];
            minutesBeforeTrusting: number;
        };
    };
    health: {
        healthz: {
            enabled: boolean;
            port: number;
            address: string;
            endpoint: string;
            healthyStatus: number;
            unhealthyStatus: number;
        };
    };
    ruleServer: {
        enabled: boolean;
        port: number;
        address: string;
        listRooms: string[];
        blocks: IRuleServerBlocks;
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
    commands: {
        allowNoPrefix: false,
        additionalPrefixes: [],
    },
    protections: {
        wordlist: {
            words: [],
            minutesBeforeTrusting: 20
        }
    },
    health: {
        healthz: {
            enabled: false,
            port: 8080,
            address: "0.0.0.0",
            endpoint: "/healthz",
            healthyStatus: 200,
            unhealthyStatus: 418,
        },
    },
    ruleServer: {
        enabled: false,
        port: 8080,
        address: '0.0.0.0',
        listRooms: [],
        blocks: {
            messages: {
                users: false,
                rooms: false,
                servers: false,
            },
            invites: {
                users: false,
                rooms: false,
                servers: false,
            },
            usernames: {
                users: false,
                rooms: false,
                servers: false,
            },
            roomCreate: {
                users: false,
                rooms: false,
                servers: false,
            },
            makeAlias: {
                users: false,
                rooms: false,
                servers: false,
            },
            publishRoom: {
                users: false,
                rooms: false,
                servers: false,
            },
        }
    },

    // Needed to make the interface happy.
    RUNTIME: {
        client: null,
    },
};

const finalConfig = <IConfig>Object.assign({}, defaultConfig, config);
export default finalConfig;
