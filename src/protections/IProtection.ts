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

import { Mjolnir } from "../Mjolnir";
import { AbstractProtectionSetting } from "./ProtectionSettings";
import { Consequence } from "./consequence";

/**
 * Represents a protection mechanism of sorts. Protections are intended to be
 * event-based (ie: X messages in a period of time, or posting X events).
 *
 * Protections are guaranteed to be run before redaction handlers.
 */
export abstract class Protection {
    abstract readonly name: string;
    abstract readonly description: string;
    enabled = false;
    readonly requiredStatePermissions: string[] = [];
    abstract settings: { [setting: string]: AbstractProtectionSetting<any, any> };

    /**
     * A new room has been added to the list of rooms to protect with this protection.
     */
    async startProtectingRoom(mjolnir: Mjolnir, roomId: string) {
        // By default, do nothing.
    }

    /**
     * A room has been removed from the list of rooms to protect with this protection.
     */
    async stopProtectingRoom(mjolnir: Mjolnir, roomId: string) {
        // By default, do nothing.
    }

    /*
     * Handle a single event from a protected room, to decide if we need to
     * respond to it
     */
    async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<Consequence[] | any> {
        // By default, do nothing.
    }

    /*
     * Handle a single reported event from a protecte room, to decide if we
     * need to respond to it
     */
    async handleReport(
        mjolnir: Mjolnir,
        roomId: string,
        reporterId: string,
        event: any,
        reason?: string,
    ): Promise<any> {
        // By default, do nothing.
    }

    /**
     * Return status information for `!mjolnir status ${protectionName}`.
     */
    async statusCommand(mjolnir: Mjolnir, subcommand: string[]): Promise<{ html: string; text: string } | null> {
        // By default, protections don't have any status to show.
        return null;
    }

    public stop(): void {
        // by default do nothing
    }
}
