/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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

export const ERROR_KIND_PERMISSION = "permission";
export const ERROR_KIND_FATAL = "fatal";

const TRIGGER_INTERVALS: { [key: string]: number } = {
    [ERROR_KIND_PERMISSION]: 3 * 60 * 60 * 1000, // 3 hours
    [ERROR_KIND_FATAL]: 15 * 60 * 1000, // 15 minutes
};

export default class ErrorCache {
    private static roomsToErrors: { [roomId: string]: { [kind: string]: number } } = {};

    private constructor() {
    }

    public static resetError(roomId: string, kind: string) {
        if (!ErrorCache.roomsToErrors[roomId]) {
            ErrorCache.roomsToErrors[roomId] = {};
        }
        ErrorCache.roomsToErrors[roomId][kind] = 0;
    }

    public static triggerError(roomId: string, kind: string): boolean {
        if (!ErrorCache.roomsToErrors[roomId]) {
            ErrorCache.roomsToErrors[roomId] = {};
        }

        const triggers = ErrorCache.roomsToErrors[roomId];
        if (!triggers[kind]) {
            triggers[kind] = 0;
        }

        const lastTriggerTime = triggers[kind];
        const now = new Date().getTime();
        const interval = TRIGGER_INTERVALS[kind];

        if ((now - lastTriggerTime) >= interval) {
            triggers[kind] = now;
            return true;
        } else {
            return false;
        }
    }
}
