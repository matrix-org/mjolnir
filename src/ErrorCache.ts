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

/**
 * The ErrorCache is used to suppress the same error messages for the same error state.
 * An example would be when mjolnir has been told to protect a room but is missing some permission such as the ability to send `m.room.server_acl`.
 * Each time `Mjolnir` synchronizes policies to protected rooms Mjolnir will try to log to the management room that Mjolnir doesn't have permission to send `m.room.server_acl`.
 * The ErrorCache is an attempt to make sure the error is reported only once.
 */
export default class ErrorCache {
    private roomsToErrors: Map<string/*room id*/, Map<string /*error kind*/, number>> = new Map();

    constructor() {
    }

    /**
     * Reset the error cache for a room/kind in the situation where circumstances have changed e.g. if Mjolnir has been informed via sync of a `m.room.power_levels` event in the room, we would want to clear `ERROR_KIND_PERMISSION`
     * so that a user can see if their changes worked.
     * @param roomId The room to reset the error cache for.
     * @param kind The kind of error we are resetting.
     */
    public resetError(roomId: string, kind: string) {
        if (!this.roomsToErrors.has(roomId)) {
            this.roomsToErrors.set(roomId, new Map());
        }
        this.roomsToErrors.get(roomId)?.set(kind, 0);
    }

    /**
     * Register the error with the cache.
     * @param roomId The room where the error is occuring or related to.
     * @param kind What kind of error, either `ERROR_KIND_PERMISSION` or `ERROR_KIND_FATAL`.
     * @returns True if the error kind has been triggered in that room,
     * meaning it has been longer than the time specified in `TRIGGER_INTERVALS` since the last trigger (or the first trigger). Otherwise false.
     */
    public triggerError(roomId: string, kind: string): boolean {
        if (!this.roomsToErrors.get(roomId)) {
            this.roomsToErrors.set(roomId, new Map());
        }

        const triggers = this.roomsToErrors.get(roomId)!;
        if (!triggers.has(kind)) {
            triggers?.set(kind, 0);
        }

        const lastTriggerTime = triggers.get(kind)!;
        const now = new Date().getTime();
        const interval = TRIGGER_INTERVALS[kind];

        if ((now - lastTriggerTime) >= interval) {
            triggers.set(kind, now);
            return true;
        } else {
            return false;
        }
    }
}
