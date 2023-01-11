/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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
import { LoggingOpts } from "matrix-appservice-bridge";

export interface IConfig {
    /** Details for the homeserver the appservice will be serving */
    homeserver: {
        /** The domain of the homeserver that is found at the end of mxids */
        domain: string,
        /** The url to use to acccess the client server api e.g. "https://matrix-client.matrix.org" */
        url: string
    },
    /** Details for the database backend */
    db: {
        /** Postgres connection string  */
        connectionString: string
    },
    /** Config for the web api used to access the appservice via the widget */
    webAPI: {
        port: number
    },
    /** A policy room for controlling access to the appservice */
    accessControlList: string,
    /** configuration for matrix-appservice-bridge's Logger */
    logging?: LoggingOpts,
    health?: {
        // If specified, attempt to upload any crash statistics to sentry.
        sentry?: {
            dsn: string;

            // Frequency of performance monitoring.
            //
            // A number in [0.0, 1.0], where 0.0 means "don't bother with tracing"
            // and 1.0 means "trace performance at every opportunity".
            tracesSampleRate: number;
        };
        openMetrics?: {
            /**
             * If `true`, expose a web server for server metrics, e.g. performance.
             *
             * Intended to be used with Prometheus or another Open Metrics scrapper.
             */
            enabled: boolean;
            /**
             * The port on which to expose server metrics.
             */
            port: number;
            /**
             * The path at which to collect health metrics.
             *
             * If unspecified, use `"/metrics"`.
             */
            endpoint: string;
            /**
             * If specified, only serve this address mask.
             *
             * If unspecified, use 0.0.0.0 (accessible by any host).
             */
            address: string;
        }
    },
    bot: {
        /** a display name */
        displayName?: string,
    },
}

export function read(configPath: string): IConfig {
    const content = fs.readFileSync(configPath, "utf8");
    const parsed = load(content);
    const config = (parsed as object) as IConfig;
    addDefaults(config);
    return config;
}

export function addDefaults(config: IConfig) {
    if (!config.bot) {
        config.bot = {};
    }
    if (!config.bot.displayName) {
        config.bot.displayName = "Moderation Bot";
    }
}