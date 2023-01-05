/*
Copyright 2019 - 2022 The Matrix.org Foundation C.I.C.

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

import { FirstMessageIsImage } from "./FirstMessageIsImage";
import { Protection } from "./IProtection";
import { BasicFlooding } from "./BasicFlooding";
import { DetectFederationLag } from "./DetectFederationLag";
import { WordList } from "./WordList";
import { MessageIsVoice } from "./MessageIsVoice";
import { MessageIsMedia } from "./MessageIsMedia";
import { TrustedReporters } from "./TrustedReporters";
import { JoinWaveShortCircuit } from "./JoinWaveShortCircuit";
import { Mjolnir } from "../Mjolnir";
import { extractRequestError, LogLevel, LogService, Permalinks } from "matrix-bot-sdk";
import { ProtectionSettingValidationError } from "./ProtectionSettings";
import { Consequence } from "./consequence";
import { htmlEscape } from "../utils";
import { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "../ErrorCache";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { LocalAbuseReports } from "./LocalAbuseReports";

const PROTECTIONS: Protection[] = [
    new FirstMessageIsImage(),
    new BasicFlooding(),
    new WordList(),
    new MessageIsVoice(),
    new MessageIsMedia(),
    new TrustedReporters(),
    new DetectFederationLag(),
    new JoinWaveShortCircuit(),
    new LocalAbuseReports(),
];

const ENABLED_PROTECTIONS_EVENT_TYPE = "org.matrix.mjolnir.enabled_protections";
const CONSEQUENCE_EVENT_DATA = "org.matrix.mjolnir.consequence";

/**
 * This is responsible for informing protections about relevant events and handle standard consequences.
 */
export class ProtectionManager {
    private _protections = new Map<string /* protection name */, Protection>();
    get protections(): Readonly<Map<string /* protection name */, Protection>> {
        return this._protections;
    }


    constructor(private readonly mjolnir: Mjolnir) {
    }

    /*
     * Take all the builtin protections, register them to set their enabled (or not) state and
     * update their settings with any saved non-default values
     */
    public async start() {
        this.mjolnir.reportManager.on("report.new", this.handleReport.bind(this));
        this.mjolnir.matrixEmitter.on("room.event", this.handleEvent.bind(this));
        for (const protection of PROTECTIONS) {
            try {
                await this.registerProtection(protection);
            } catch (e) {
                this.mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "ProtectionManager", extractRequestError(e));
            }
        }
    }

    /**
     * Given a protection object; add it to our list of protections, set it up if it has been enabled previously (in account data)
     * and update its settings with any saved non-default values. See `ENABLED_PROTECTIONS_EVENT_TYPE`.
     *
     * @param protection The protection object we want to register
     */
    public async registerProtection(protection: Protection) {
        this._protections.set(protection.name, protection)

        let enabledProtections: { enabled: string[] } | null = null;
        try {
            enabledProtections = await this.mjolnir.client.getAccountData(ENABLED_PROTECTIONS_EVENT_TYPE);
        } catch {
            // this setting either doesn't exist, or we failed to read it (bad network?)
            // TODO: retry on certain failures?
        }
        protection.enabled = enabledProtections?.enabled.includes(protection.name) ?? false;

        const savedSettings = await this.getProtectionSettings(protection.name);
        for (let [key, value] of Object.entries(savedSettings)) {
            // this.getProtectionSettings() validates this data for us, so we don't need to
            protection.settings[key].setValue(value);
        }
        if (protection.enabled) {
            for (let roomId of this.mjolnir.protectedRoomsTracker.getProtectedRooms()) {
                await protection.startProtectingRoom(this.mjolnir, roomId);
            }
        }
    }

    /*
     * Given a protection object; remove it from our list of protections.
     *
     * @param protection The protection object we want to unregister
     */
    public async unregisterProtection(protectionName: string) {
        let protection = this._protections.get(protectionName);
        if (!protection) {
            throw new Error("Failed to find protection by name: " + protectionName);
        }
        this._protections.delete(protectionName);
        if (protection.enabled) {
            for (let roomId of this.mjolnir.protectedRoomsTracker.getProtectedRooms()) {
                await protection.stopProtectingRoom(this.mjolnir, roomId);
            }
        }
    }

    /*
     * Takes an object of settings we want to change and what their values should be,
     * check that their values are valid, combine them with current saved settings,
     * then save the amalgamation to a state event
     *
     * @param protectionName Which protection these settings belong to
     * @param changedSettings The settings to change and their values
     */
    public async setProtectionSettings(protectionName: string, changedSettings: { [setting: string]: any }): Promise<any> {
        const protection = this._protections.get(protectionName);
        if (protection === undefined) {
            return;
        }

        const validatedSettings: { [setting: string]: any } = await this.getProtectionSettings(protectionName);

        for (let [key, value] of Object.entries(changedSettings)) {
            if (!(key in protection.settings)) {
                throw new ProtectionSettingValidationError(`Failed to find protection setting by name: ${key}`);
            }
            if (typeof (protection.settings[key].value) !== typeof (value)) {
                throw new ProtectionSettingValidationError(`Invalid type for protection setting: ${key} (${typeof (value)})`);
            }
            if (!protection.settings[key].validate(value)) {
                throw new ProtectionSettingValidationError(`Invalid value for protection setting: ${key} (${value})`);
            }
            validatedSettings[key] = value;
        }

        await this.mjolnir.client.sendStateEvent(
            this.mjolnir.managementRoomId, 'org.matrix.mjolnir.setting', protectionName, validatedSettings
        );
    }

    /*
     * Make a list of the names of enabled protections and save them in a state event
     */
    private async saveEnabledProtections() {
        const protections = this.enabledProtections.map(p => p.name);
        await this.mjolnir.client.setAccountData(ENABLED_PROTECTIONS_EVENT_TYPE, { enabled: protections });
    }
    /*
     * Enable a protection by name and persist its enable state in to a state event
     *
     * @param name The name of the protection whose settings we're enabling
     */
    public async enableProtection(name: string) {
        const protection = this._protections.get(name);
        if (protection === undefined) {
            return;
        }
        protection.enabled = true;
        await this.saveEnabledProtections();
        for (let roomId of this.mjolnir.protectedRoomsTracker.getProtectedRooms()) {
            await protection.startProtectingRoom(this.mjolnir, roomId);
        }
    }

    public get enabledProtections(): Protection[] {
        return [...this._protections.values()].filter(p => p.enabled);
    }

    /**
     * Get a protection by name.
     *
     * @return If there is a protection with this name *and* it is enabled,
     * return the protection.
     */
    public getProtection(protectionName: string): Protection | null {
        return this._protections.get(protectionName) ?? null;
    }


    /*
     * Disable a protection by name and remove it from the persistent list of enabled protections
     *
     * @param name The name of the protection whose settings we're disabling
     */
    public async disableProtection(name: string) {
        const protection = this._protections.get(name);
        if (protection === undefined) {
            return;
        }
        protection.enabled = false;
        await this.saveEnabledProtections();
        for (let roomId of this.mjolnir.protectedRoomsTracker.getProtectedRooms()) {
            await protection.stopProtectingRoom(this.mjolnir, roomId);
        }
    }

    /*
     * Read org.matrix.mjolnir.setting state event, find any saved settings for
     * the requested protectionName, then iterate and validate against their parser
     * counterparts in Protection.settings and return those which validate
     *
     * @param protectionName The name of the protection whose settings we're reading
     * @returns Every saved setting for this protectionName that has a valid value
     */
    public async getProtectionSettings(protectionName: string): Promise<{ [setting: string]: any }> {
        let savedSettings: { [setting: string]: any } = {}
        try {
            savedSettings = await this.mjolnir.client.getRoomStateEvent(
                this.mjolnir.managementRoomId, 'org.matrix.mjolnir.setting', protectionName
            );
        } catch {
            // setting does not exist, return empty object
            return {};
        }

        const settingDefinitions = this._protections.get(protectionName)?.settings ?? {};
        const validatedSettings: { [setting: string]: any } = {}
        for (let [key, value] of Object.entries(savedSettings)) {
            if (
                // is this a setting name with a known parser?
                key in settingDefinitions
                // is the datatype of this setting's value what we expect?
                && typeof (settingDefinitions[key].value) === typeof (value)
                // is this setting's value valid for the setting?
                && settingDefinitions[key].validate(value)
            ) {
                validatedSettings[key] = value;
            } else {
                await this.mjolnir.managementRoomOutput.logMessage(
                    LogLevel.WARN,
                    "getProtectionSetting",
                    `Tried to read ${protectionName}.${key} and got invalid value ${value}`
                );
            }
        }
        return validatedSettings;
    }

    private async handleConsequences(protection: Protection, roomId: string, eventId: string, sender: string, consequences: Consequence[]) {
        for (const consequence of consequences) {
            try {
                if (consequence.name === "alert") {
                    /* take no additional action, just print the below message to management room */
                } else if (consequence.name === "ban") {
                    await this.mjolnir.client.banUser(sender, roomId, "abuse detected");
                } else if (consequence.name === "redact") {
                    await this.mjolnir.client.redactEvent(roomId, eventId, "abuse detected");
                } else {
                    throw new Error(`unknown consequence ${consequence.name}`);
                }

                let message = `protection ${protection.name} enacting`
                    + ` ${consequence.name}`
                    + ` against ${htmlEscape(sender)}`
                    + ` in ${htmlEscape(roomId)}`
                    + ` (reason: ${htmlEscape(consequence.reason)})`;
                await this.mjolnir.client.sendMessage(this.mjolnir.managementRoomId, {
                    msgtype: "m.notice",
                    body: message,
                    [CONSEQUENCE_EVENT_DATA]: {
                        who: sender,
                        room: roomId,
                        types: [consequence.name],
                    }
                });
            } catch (e) {
                await this.mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, "handleConsequences", `Failed to enact ${consequence.name} consequence: ${e}`);
            }
        }
    }

    private async handleEvent(roomId: string, event: any) {
        if (this.mjolnir.protectedRoomsTracker.getProtectedRooms().includes(roomId)) {
            if (event['sender'] === await this.mjolnir.client.getUserId()) return; // Ignore ourselves

            // Iterate all the enabled protections
            for (const protection of this.enabledProtections) {
                let consequences: Consequence[] | undefined = undefined;
                try {
                    consequences = await protection.handleEvent(this.mjolnir, roomId, event);
                } catch (e) {
                    const eventPermalink = Permalinks.forEvent(roomId, event['event_id']);
                    LogService.error("ProtectionManager", "Error handling protection: " + protection.name);
                    LogService.error("ProtectionManager", "Failed event: " + eventPermalink);
                    LogService.error("ProtectionManager", extractRequestError(e));
                    await this.mjolnir.client.sendNotice(this.mjolnir.managementRoomId, "There was an error processing an event through a protection - see log for details. Event: " + eventPermalink);
                    continue;
                }

                if (consequences !== undefined) {
                    await this.handleConsequences(protection, roomId, event["event_id"], event["sender"], consequences);
                }
            }

            // Run the event handlers - we always run this after protections so that the protections
            // can flag the event for redaction.
            await this.mjolnir.unlistedUserRedactionHandler.handleEvent(roomId, event, this.mjolnir); // FIXME: That's rather spaghetti
        }
    }


    private requiredProtectionPermissions(): Set<string> {
        return new Set(this.enabledProtections.map((p) => p.requiredStatePermissions).flat())
    }

    public async verifyPermissionsIn(roomId: string): Promise<RoomUpdateError[]> {
        const errors: RoomUpdateError[] = [];
        const additionalPermissions = this.requiredProtectionPermissions();

        try {
            const ownUserId = await this.mjolnir.client.getUserId();

            const powerLevels = await this.mjolnir.client.getRoomStateEvent(roomId, "m.room.power_levels", "");
            if (!powerLevels) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Missing power levels state event");
            }

            function plDefault(val: number | undefined | null, def: number): number {
                if (!val && val !== 0) return def;
                return val;
            }

            const users = powerLevels['users'] || {};
            const events = powerLevels['events'] || {};
            const usersDefault = plDefault(powerLevels['users_default'], 0);
            const stateDefault = plDefault(powerLevels['state_default'], 50);
            const ban = plDefault(powerLevels['ban'], 50);
            const kick = plDefault(powerLevels['kick'], 50);
            const redact = plDefault(powerLevels['redact'], 50);

            const userLevel = plDefault(users[ownUserId], usersDefault);
            const aclLevel = plDefault(events["m.room.server_acl"], stateDefault);

            // Wants: ban, kick, redact, m.room.server_acl

            if (userLevel < ban) {
                errors.push({
                    roomId,
                    errorMessage: `Missing power level for bans: ${userLevel} < ${ban}`,
                    errorKind: ERROR_KIND_PERMISSION,
                });
            }
            if (userLevel < kick) {
                errors.push({
                    roomId,
                    errorMessage: `Missing power level for kicks: ${userLevel} < ${kick}`,
                    errorKind: ERROR_KIND_PERMISSION,
                });
            }
            if (userLevel < redact) {
                errors.push({
                    roomId,
                    errorMessage: `Missing power level for redactions: ${userLevel} < ${redact}`,
                    errorKind: ERROR_KIND_PERMISSION,
                });
            }
            if (userLevel < aclLevel) {
                errors.push({
                    roomId,
                    errorMessage: `Missing power level for server ACLs: ${userLevel} < ${aclLevel}`,
                    errorKind: ERROR_KIND_PERMISSION,
                });
            }

            // Wants: Additional permissions

            for (const additionalPermission of additionalPermissions) {
                const permLevel = plDefault(events[additionalPermission], stateDefault);

                if (userLevel < permLevel) {
                    errors.push({
                        roomId,
                        errorMessage: `Missing power level for "${additionalPermission}" state events: ${userLevel} < ${permLevel}`,
                        errorKind: ERROR_KIND_PERMISSION,
                    });
                }
            }

            // Otherwise OK
        } catch (e) {
            LogService.error("Mjolnir", extractRequestError(e));
            errors.push({
                roomId,
                errorMessage: e.message || (e.body ? e.body.error : '<no message>'),
                errorKind: ERROR_KIND_FATAL,
            });
        }

        return errors;
    }

    private async handleReport({ roomId, reporterId, event, reason }: { roomId: string, reporterId: string, event: any, reason?: string }) {
        for (const protection of this.enabledProtections) {
            await protection.handleReport(this.mjolnir, roomId, reporterId, event, reason);
        }
    }

    public async addProtectedRoom(roomId: string) {
        for (const protection of this.enabledProtections) {
            try {
                await protection.startProtectingRoom(this.mjolnir, roomId);
            } catch (ex) {
                this.mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, protection.name, ex);
            }
        }
    }

    public async removeProtectedRoom(roomId: string) {
        for (const protection of this.enabledProtections) {
            try {
                await protection.stopProtectingRoom(this.mjolnir, roomId);
            } catch (ex) {
                this.mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, protection.name, ex);
            }
        }
    }
}
