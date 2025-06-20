/*
Copyright 2019-2022 The Matrix.org Foundation C.I.C.

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

import * as fs from "fs";
import { load } from "js-yaml";
import { MatrixClient, LogService } from "@vector-im/matrix-bot-sdk";
import { IHealthConfig } from "./IHealthConfig";
import { extend } from "lodash";

export interface IConfig {
    health: IHealthConfig,
    homeserverUrl: string;
    rawHomeserverUrl: string;
    accessToken: string;
    // The management room for the bot to listen in.
    managementRoom: string;

    // The display name of the bot.
    displayName?: string;

    // The avatar for the bot.
    avatarUrl?: string;

    // How often to post status reports in the management room, in minutes.
    // Set to 0 to disable.
    statusReportIntervalMinutes: number;
    /**
     * If true, Mjolnir will only accept invites from users present in managementRoom.
     * Otherwise a space must be provided to `acceptInvitesFromSpace`.
     */
    autojoinOnlyIfManager: boolean;
    /** Mjolnir will accept invites from members of this space if `autojoinOnlyIfManager` is false. */
    acceptInvitesFromSpace: string;
    recordIgnoredInvites: boolean;
    verboseLogging: boolean;
    logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
    syncOnStartup: boolean;
    verifyPermissionsOnStartup: boolean;
    noop: boolean;
    dataPath: string;
    // The list of rooms to protect.
    protectedRooms: string[];
    // What to consider as `recent` for the sync command's output, in hours.
    syncCommandCacheHours: number;
    // The prefix for commands.
    commandPrefix: string;
    // Whether to confirm a wildcard ban.
    confirmWildcardBan: boolean;
    // The maximum number of members to check for redactions at a time.
    maxRedactionCheckMembers: number;
    // The maximum number of milliseconds to wait between redaction batches.
    redactionBatchLingerMillis: number;
    // The maximum number of events to redact at a time.
    maxRedactionEvents: number;
    // A list of user IDs to ignore, preventing them from being banned.
    ignoredUsers: string[];
    // Glob strings for reasons to automatically redact messages for.
    automaticallyRedactForReasons: string[];
    // The number of minutes a user must be trusted for before they can speak without being
    // restricted by the word list.
    minutesBeforeTrusting: number;
    // A list of words to redact messages for.
    words: string[];
    // Whether to protect all rooms Mjolnir is in.
    protectAllJoinedRooms: boolean;
    // The maximum number of seconds to wait before checking for redactions again.
    redactionIntervalSeconds: number;
    // The queue to use for redactions. Currently only 'unlisted' is supported.
    redactionQueue: "unlisted";
    // Whether to enable polling for reports.
    pollReports: boolean;
    // The list of protections to enable.
    protections: {
        [protection: string]: any;
    };
    web: {
        enabled: boolean;
        port: number;
        address: string;
        ruleServer?: {
            enabled: boolean;
        }
    };
    /**
     * Config options only set at runtime. Try to avoid using the objects
     * here as much as possible.
     */
    RUNTIME?: {
        client?: MatrixClient;
    };
    commands: {
        allowNoPrefix: boolean;
        additionalPrefixes: string[];
    };
    hma: {
        url: string;
    };
}

export const defaultConfig: IConfig = {
    homeserverUrl: "http://localhost:8008",
    rawHomeserverUrl: "http://localhost:8008",
    accessToken: "YOUR_ACCESS_TOKEN",
    managementRoom: "#mjolnir:localhost",
    displayName: "Mjolnir",
    statusReportIntervalMinutes: 10,
    autojoinOnlyIfManager: true,
    acceptInvitesFromSpace: "!somewhere:example.org", // Linter, you are wrong.
    recordIgnoredInvites: false,
    verboseLogging: true,
    logLevel: "INFO",
    syncOnStartup: true,
    verifyPermissionsOnStartup: true,
    noop: false,
    dataPath: "./data",
    protectedRooms: [],
    syncCommandCacheHours: 24,
    commandPrefix: "!mjolnir",
    confirmWildcardBan: true,
    commands: {
        allowNoPrefix: false,
        additionalPrefixes: [],
    },
    maxRedactionCheckMembers: 10,
    redactionBatchLingerMillis: 1000,
    maxRedactionEvents: 10,
    ignoredUsers: [],
    automaticallyRedactForReasons: [
        "spam",
        "advertisement",
    ],
    minutesBeforeTrusting: 20,
    words: [],
    protectAllJoinedRooms: false,
    redactionIntervalSeconds: 60 * 60,
    redactionQueue: "unlisted",
    pollReports: true,
    protections: {
        "BasicFlooding": {},
        "WordList": {},
        "MessageIsVoice": {},
        "MessageIsMedia": {},
    },
    web: {
        enabled: false,
        port: 8090,
        address: "0.0.0.0",
        ruleServer: {
            enabled: false,
        }
    },
    health: {
        enabled: false,
        port: 8091,
        address: "0.0.0.0",
    },
    hma: {
        url: "http://localhost:8080",
    }
};

export function read(configPath = "config/production.yaml"): IConfig {
    const file = fs.readFileSync(configPath, "utf8");
    const loadedConfig = load(file) as any;
    return extend({}, defaultConfig, loadedConfig);
}

export function findProtection(name: string, config: IConfig) {
    for (const protectionName in config.protections) {
        if (protectionName.toLowerCase() === name.toLowerCase()) {
            return config.protections[protectionName];
        }
    }
    return undefined;
}

export function MjolnirConfigLayer(protectionName: string, overrides: any, config: IConfig): IConfig {
    const newConfig = { ...config };
    const protectionConfig = findProtection(protectionName, config);
    if (protectionConfig) {
        newConfig.protections[protectionName] = { ...protectionConfig, ...overrides };
    } else {
        newConfig.protections[protectionName] = overrides;
    }
    return newConfig;
}
