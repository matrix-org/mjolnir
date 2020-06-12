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

import { CreateEvent, LogLevel, LogService, MatrixClient, MatrixGlob, Permalinks, UserID } from "matrix-bot-sdk";
import BanList, { ALL_RULE_TYPES } from "./models/BanList";
import { applyServerAcls } from "./actions/ApplyAcl";
import { RoomUpdateError } from "./models/RoomUpdateError";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";
import { applyUserBans } from "./actions/ApplyBan";
import config from "./config";
import { logMessage } from "./LogProxy";
import ErrorCache, { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "./ErrorCache";
import { IProtection } from "./protections/IProtection";
import { PROTECTIONS } from "./protections/protections";
import { AutomaticRedactionQueue } from "./queues/AutomaticRedactionQueue";
import { Healthz } from "./health/healthz";

export const STATE_NOT_STARTED = "not_started";
export const STATE_CHECKING_PERMISSIONS = "checking_permissions";
export const STATE_SYNCING = "syncing";
export const STATE_RUNNING = "running";

const WATCHED_LISTS_EVENT_TYPE = "org.matrix.mjolnir.watched_lists";
const ENABLED_PROTECTIONS_EVENT_TYPE = "org.matrix.mjolnir.enabled_protections";
const PROTECTED_ROOMS_EVENT_TYPE = "org.matrix.mjolnir.protected_rooms";
const WARN_UNPROTECTED_ROOM_EVENT_PREFIX = "org.matrix.mjolnir.unprotected_room_warning.for.";

export class Mjolnir {

    private displayName: string;
    private localpart: string;
    private currentState: string = STATE_NOT_STARTED;
    private protections: IProtection[] = [];
    private redactionQueue = new AutomaticRedactionQueue();
    private automaticRedactionReasons: MatrixGlob[] = [];
    private protectedJoinedRoomIds: string[] = [];
    private explicitlyProtectedRoomIds: string[] = [];
    private knownUnprotectedRooms: string[] = [];

    constructor(
        public readonly client: MatrixClient,
        public readonly protectedRooms: { [roomId: string]: string },
        private banLists: BanList[],
    ) {
        this.explicitlyProtectedRoomIds = Object.keys(this.protectedRooms);

        for (const reason of config.automaticallyRedactForReasons) {
            this.automaticRedactionReasons.push(new MatrixGlob(reason.toLowerCase()));
        }

        client.on("room.event", this.handleEvent.bind(this));

        client.on("room.message", async (roomId, event) => {
            if (roomId !== config.managementRoom) return;
            if (!event['content']) return;

            const content = event['content'];
            if (content['msgtype'] === "m.text" && content['body']) {
                const prefixes = [
                    COMMAND_PREFIX,
                    this.localpart + ":",
                    this.displayName + ":",
                    await client.getUserId() + ":",
                    this.localpart + " ",
                    this.displayName + " ",
                    await client.getUserId() + " ",
                    ...config.commands.additionalPrefixes.map(p => `!${p}`),
                    ...config.commands.additionalPrefixes.map(p => `${p}:`),
                    ...config.commands.additionalPrefixes.map(p => `${p} `),
                    ...config.commands.additionalPrefixes,
                ];
                if (config.commands.allowNoPrefix) prefixes.push("!");

                const prefixUsed = prefixes.find(p => content['body'].startsWith(p));
                if (!prefixUsed) return;

                // rewrite the event body to make the prefix uniform (in case the bot has spaces in its display name)
                let restOfBody = content['body'].substring(prefixUsed.length);
                if (!restOfBody.startsWith(" ")) restOfBody = ` ${restOfBody}`;
                event['content']['body'] = COMMAND_PREFIX + restOfBody;
                LogService.info("Mjolnir", `Command being run by ${event['sender']}: ${event['content']['body']}`);

                await client.sendReadReceipt(roomId, event['event_id']);
                return handleCommand(roomId, event, this);
            }
        });

        client.on("room.join", (roomId: string, event: any) => {
            LogService.info("Mjolnir", `Joined ${roomId}`);
            return this.resyncJoinedRooms();
        });
        client.on("room.leave", (roomId: string, event: any) => {
            LogService.info("Mjolnir", `Left ${roomId}`);
            return this.resyncJoinedRooms();
        });

        client.getUserId().then(userId => {
            this.localpart = userId.split(':')[0].substring(1);
            return client.getUserProfile(userId);
        }).then(profile => {
            if (profile['displayname']) {
                this.displayName = profile['displayname'];
            }
        });
    }

    public get lists(): BanList[] {
        return this.banLists;
    }

    public get state(): string {
        return this.currentState;
    }

    public get enabledProtections(): IProtection[] {
        return this.protections;
    }

    public get redactionHandler(): AutomaticRedactionQueue {
        return this.redactionQueue;
    }

    public get automaticRedactGlobs(): MatrixGlob[] {
        return this.automaticRedactionReasons;
    }

    public start() {
        return this.client.start().then(async () => {
            this.currentState = STATE_CHECKING_PERMISSIONS;

            await logMessage(LogLevel.DEBUG, "Mjolnir@startup", "Loading protected rooms...");
            await this.resyncJoinedRooms(false);
            try {
                const data = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
                if (data && data['rooms']) {
                    for (const roomId of data['rooms']) {
                        this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
                        this.explicitlyProtectedRoomIds.push(roomId);
                    }
                }
            } catch (e) {
                LogService.warn("Mjolnir", e);
            }
            await this.buildWatchedBanLists();
            this.applyUnprotectedRooms();

            if (config.verifyPermissionsOnStartup) {
                await logMessage(LogLevel.INFO, "Mjolnir@startup", "Checking permissions...");
                await this.verifyPermissions(config.verboseLogging);
            }
        }).then(async () => {
            this.currentState = STATE_SYNCING;
            if (config.syncOnStartup) {
                await logMessage(LogLevel.INFO, "Mjolnir@startup", "Syncing lists...");
                await this.syncLists(config.verboseLogging);
                await this.enableProtections();
            }
        }).then(async () => {
            this.currentState = STATE_RUNNING;
            Healthz.isHealthy = true;
            await logMessage(LogLevel.INFO, "Mjolnir@startup", "Startup complete. Now monitoring rooms.");
        }).catch(async err => {
            try {
                LogService.error("Mjolnir", "Error during startup:");
                LogService.error("Mjolnir", err);
                await logMessage(LogLevel.ERROR, "Mjolnir@startup", "Startup failed due to error - see console");
            } catch (e) {
                // If we failed to handle the error, just crash
                console.error(e);
                process.exit(1);
            }
        });
    }

    public async addProtectedRoom(roomId: string) {
        this.protectedRooms[roomId] = Permalinks.forRoom(roomId);

        const unprotectedIdx = this.knownUnprotectedRooms.indexOf(roomId);
        if (unprotectedIdx >= 0) this.knownUnprotectedRooms.splice(unprotectedIdx, 1);
        this.explicitlyProtectedRoomIds.push(roomId);

        let additionalProtectedRooms;
        try {
            additionalProtectedRooms = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
        } catch (e) {
            LogService.warn("Mjolnir", e);
        }
        if (!additionalProtectedRooms || !additionalProtectedRooms['rooms']) additionalProtectedRooms = {rooms: []};
        additionalProtectedRooms.rooms.push(roomId);
        await this.client.setAccountData(PROTECTED_ROOMS_EVENT_TYPE, additionalProtectedRooms);
        await this.syncLists(config.verboseLogging);
    }

    public async removeProtectedRoom(roomId: string) {
        delete this.protectedRooms[roomId];

        const idx = this.explicitlyProtectedRoomIds.indexOf(roomId);
        if (idx >= 0) this.explicitlyProtectedRoomIds.splice(idx, 1);

        let additionalProtectedRooms;
        try {
            additionalProtectedRooms = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
        } catch (e) {
            LogService.warn("Mjolnir", e);
        }
        if (!additionalProtectedRooms || !additionalProtectedRooms['rooms']) additionalProtectedRooms = {rooms: []};
        additionalProtectedRooms.rooms = additionalProtectedRooms.rooms.filter(r => r !== roomId);
        await this.client.setAccountData(PROTECTED_ROOMS_EVENT_TYPE, additionalProtectedRooms);
    }

    private async resyncJoinedRooms(withSync = true) {
        if (!config.protectAllJoinedRooms) return;

        const joinedRoomIds = (await this.client.getJoinedRooms()).filter(r => r !== config.managementRoom);
        for (const roomId of this.protectedJoinedRoomIds) {
            delete this.protectedRooms[roomId];
        }
        this.protectedJoinedRoomIds = joinedRoomIds;
        for (const roomId of joinedRoomIds) {
            this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
        }

        this.applyUnprotectedRooms();

        if (withSync) {
            await this.syncLists(config.verboseLogging);
        }
    }

    private async getEnabledProtections() {
        let enabled: string[] = [];
        try {
            const protections = await this.client.getAccountData(ENABLED_PROTECTIONS_EVENT_TYPE);
            if (protections && protections['enabled']) {
                for (const protection of protections['enabled']) {
                    enabled.push(protection);
                }
            }
        } catch (e) {
            LogService.warn("Mjolnir", e);
        }

        return enabled;
    }

    private async enableProtections() {
        for (const protection of await this.getEnabledProtections()) {
            try {
                this.enableProtection(protection, false);
            } catch (e) {
                LogService.warn("Mjolnir", e);
            }
        }
    }

    public async enableProtection(protectionName: string, persist = true): Promise<any> {
        const definition = PROTECTIONS[protectionName];
        if (!definition) throw new Error("Failed to find protection by name: " + protectionName);

        const protection = definition.factory();
        this.protections.push(protection);

        if (persist) {
            const existing = this.protections.map(p => p.name);
            await this.client.setAccountData(ENABLED_PROTECTIONS_EVENT_TYPE, {enabled: existing});
        }
    }

    public async disableProtection(protectionName: string): Promise<any> {
        const idx = this.protections.findIndex(p => p.name === protectionName);
        if (idx >= 0) this.protections.splice(idx, 1);

        const existing = this.protections.map(p => p.name);
        await this.client.setAccountData(ENABLED_PROTECTIONS_EVENT_TYPE, {enabled: existing});
    }

    public async watchList(roomRef: string): Promise<BanList> {
        const joinedRooms = await this.client.getJoinedRooms();
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            await this.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
        }

        if (this.banLists.find(b => b.roomId === roomId)) return null;

        const list = new BanList(roomId, roomRef, this.client);
        await list.updateList();
        this.banLists.push(list);

        await this.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: this.banLists.map(b => b.roomRef),
        });

        await this.warnAboutUnprotectedBanListRoom(roomId);

        return list;
    }

    public async unwatchList(roomRef: string): Promise<BanList> {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
        const list = this.banLists.find(b => b.roomId === roomId);
        if (list) this.banLists.splice(this.banLists.indexOf(list), 1);

        await this.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: this.banLists.map(b => b.roomRef),
        });

        return list;
    }

    public async warnAboutUnprotectedBanListRoom(roomId: string) {
        if (!config.protectAllJoinedRooms) return; // doesn't matter
        if (this.explicitlyProtectedRoomIds.includes(roomId)) return; // explicitly protected

        const createEvent = new CreateEvent(await this.client.getRoomStateEvent(roomId, "m.room.create", ""));
        if (createEvent.creator === await this.client.getUserId()) return; // we created it

        if (!this.knownUnprotectedRooms.includes(roomId)) this.knownUnprotectedRooms.push(roomId);
        this.applyUnprotectedRooms();

        try {
            const accountData = await this.client.getAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId);
            if (accountData && accountData['warned']) return; // already warned
        } catch (e) {
            // Ignore - probably haven't warned about it yet
        }

        await logMessage(LogLevel.WARN, "Mjolnir", `Not protecting ${roomId} - it is a ban list that this bot did not create. Add the room as protected if it is supposed to be protected. This warning will not appear again.`, roomId);
        await this.client.setAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId, {warned: true});
    }

    private applyUnprotectedRooms() {
        for (const roomId of this.knownUnprotectedRooms) {
            delete this.protectedRooms[roomId];
        }
    }

    public async buildWatchedBanLists() {
        const banLists: BanList[] = [];
        const joinedRooms = await this.client.getJoinedRooms();

        let watchedListsEvent = {};
        try {
            watchedListsEvent = await this.client.getAccountData(WATCHED_LISTS_EVENT_TYPE);
        } catch (e) {
            // ignore - not important
        }

        for (const roomRef of (watchedListsEvent['references'] || [])) {
            const permalink = Permalinks.parseUrl(roomRef);
            if (!permalink.roomIdOrAlias) continue;

            const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
            if (!joinedRooms.includes(roomId)) {
                await this.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
            }

            await this.warnAboutUnprotectedBanListRoom(roomId);

            const list = new BanList(roomId, roomRef, this.client);
            await list.updateList();
            banLists.push(list);
        }

        this.banLists = banLists;
    }

    public async verifyPermissions(verbose = true, printRegardless = false) {
        const errors: RoomUpdateError[] = [];
        for (const roomId of Object.keys(this.protectedRooms)) {
            errors.push(...(await this.verifyPermissionsIn(roomId)));
        }

        const hadErrors = await this.printActionResult(errors, "Permission errors in protected rooms:", printRegardless);
        if (!hadErrors && verbose) {
            const html = `<font color="#00cc00">All permissions look OK.</font>`;
            const text = "All permissions look OK.";
            await this.client.sendMessage(config.managementRoom, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
    }

    private async verifyPermissionsIn(roomId: string): Promise<RoomUpdateError[]> {
        const errors: RoomUpdateError[] = [];

        try {
            const ownUserId = await this.client.getUserId();

            const powerLevels = await this.client.getRoomStateEvent(roomId, "m.room.power_levels", "");
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

            // Otherwise OK
        } catch (e) {
            LogService.error("Mjolnir", e);
            errors.push({
                roomId,
                errorMessage: e.message || (e.body ? e.body.error : '<no message>'),
                errorKind: ERROR_KIND_FATAL,
            });
        }

        return errors;
    }

    public async syncLists(verbose = true) {
        for (const list of this.banLists) {
            await list.updateList();
        }

        let hadErrors = false;

        const aclErrors = await applyServerAcls(this.banLists, Object.keys(this.protectedRooms), this);
        const banErrors = await applyUserBans(this.banLists, Object.keys(this.protectedRooms), this);
        hadErrors = hadErrors || await this.printActionResult(aclErrors, "Errors updating server ACLs:");
        hadErrors = hadErrors || await this.printActionResult(banErrors, "Errors updating member bans:");

        if (!hadErrors && verbose) {
            const html = `<font color="#00cc00">Done updating rooms - no errors</font>`;
            const text = "Done updating rooms - no errors";
            await this.client.sendMessage(config.managementRoom, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
    }

    public async syncListForRoom(roomId: string) {
        let updated = false;
        for (const list of this.banLists) {
            if (list.roomId !== roomId) continue;
            await list.updateList();
            updated = true;
        }
        if (!updated) return;

        let hadErrors = false;

        const aclErrors = await applyServerAcls(this.banLists, Object.keys(this.protectedRooms), this);
        const banErrors = await applyUserBans(this.banLists, Object.keys(this.protectedRooms), this);
        hadErrors = hadErrors || await this.printActionResult(aclErrors, "Errors updating server ACLs:");
        hadErrors = hadErrors || await this.printActionResult(banErrors, "Errors updating member bans:");

        if (!hadErrors) {
            const html = `<font color="#00cc00"><b>Done updating rooms - no errors</b></font>`;
            const text = "Done updating rooms - no errors";
            await this.client.sendMessage(config.managementRoom, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
    }

    private async handleEvent(roomId: string, event: any) {
        // Check for UISI errors
        if (roomId === config.managementRoom) {
            if (event['type'] === 'm.room.message' && event['content'] && event['content']['body']) {
                if (event['content']['body'] === "** Unable to decrypt: The sender's device has not sent us the keys for this message. **") {
                    // UISI
                    await this.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '⚠');
                    await this.client.unstableApis.addReactionToEvent(roomId, event['event_id'], 'UISI');
                    await this.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '🚨');
                }
            }
        }

        // Check for updated ban lists before checking protected rooms - the ban lists might be protected
        // themselves.
        if (this.banLists.map(b => b.roomId).includes(roomId)) {
            if (ALL_RULE_TYPES.includes(event['type'])) {
                await this.syncListForRoom(roomId);
            }
        }

        if (Object.keys(this.protectedRooms).includes(roomId)) {
            if (event['sender'] === await this.client.getUserId()) return; // Ignore ourselves

            // Iterate all the protections
            for (const protection of this.protections) {
                try {
                    await protection.handleEvent(this, roomId, event);
                } catch (e) {
                    const eventPermalink = Permalinks.forEvent(roomId, event['event_id']);
                    LogService.error("Mjolnir", "Error handling protection: " + protection.name);
                    LogService.error("Mjolnir", "Failed event: " + eventPermalink);
                    LogService.error("Mjolnir", e);
                    await this.client.sendNotice(config.managementRoom, "There was an error processing an event through a protection - see log for details. Event: " + eventPermalink);
                }
            }

            // Run the event handlers - we always run this after protections so that the protections
            // can flag the event for redaction.
            await this.redactionQueue.handleEvent(roomId, event, this.client);

            if (event['type'] === 'm.room.power_levels' && event['state_key'] === '') {
                // power levels were updated - recheck permissions
                ErrorCache.resetError(roomId, ERROR_KIND_PERMISSION);
                await logMessage(LogLevel.DEBUG, "Mjolnir", `Power levels changed in ${roomId} - checking permissions...`, roomId);
                const errors = await this.verifyPermissionsIn(roomId);
                const hadErrors = await this.printActionResult(errors);
                if (!hadErrors) {
                    await logMessage(LogLevel.DEBUG, "Mjolnir", `All permissions look OK.`);
                }
                return;
            } else if (event['type'] === "m.room.member") {
                // Only apply bans in the room we're looking at.
                const errors = await applyUserBans(this.banLists, [roomId], this);
                await this.printActionResult(errors);
            }
        }
    }

    private async printActionResult(errors: RoomUpdateError[], title: string = null, logAnyways = false) {
        if (errors.length <= 0) return false;

        if (!logAnyways) {
            errors = errors.filter(e => ErrorCache.triggerError(e.roomId, e.errorKind));
            if (errors.length <= 0) {
                LogService.warn("Mjolnir", "Multiple errors are happening, however they are muted. Please check the management room.");
                return true;
            }
        }

        let html = "";
        let text = "";

        const htmlTitle = title ? `${title}<br />` : '';
        const textTitle = title ? `${title}\n` : '';

        html += `<font color="#ff0000"><b>${htmlTitle}${errors.length} errors updating protected rooms!</b></font><br /><ul>`;
        text += `${textTitle}${errors.length} errors updating protected rooms!\n`;
        const viaServers = [(new UserID(await this.client.getUserId())).domain];
        for (const error of errors) {
            const alias = (await this.client.getPublishedAlias(error.roomId)) || error.roomId;
            const url = Permalinks.forRoom(alias, viaServers);
            html += `<li><a href="${url}">${alias}</a> - ${error.errorMessage}</li>`;
            text += `${url} - ${error.errorMessage}\n`;
        }
        html += "</ul>";

        const message = {
            msgtype: "m.notice",
            body: text,
            format: "org.matrix.custom.html",
            formatted_body: html,
        };
        await this.client.sendMessage(config.managementRoom, message);
        return true;
    }

    public async isSynapseAdmin(): Promise<boolean> {
        try {
            const endpoint = `/_synapse/admin/v1/users/${await this.client.getUserId()}/admin`;
            const response = await this.client.doRequest("GET", endpoint);
            return response['admin'];
        } catch (e) {
            LogService.error("Mjolnir", "Error determining if Mjolnir is a server admin:");
            LogService.error("Mjolnir", e);
            return false; // assume not
        }
    }

    public async deactivateSynapseUser(userId: string): Promise<any> {
        const endpoint = `/_synapse/admin/v1/deactivate/${userId}`;
        return await this.client.doRequest("POST", endpoint);
    }

    public async shutdownSynapseRoom(roomId: string): Promise<any> {
        const endpoint = `/_synapse/admin/v1/shutdown_room/${roomId}`;
        return await this.client.doRequest("POST", endpoint, null, {
            new_room_user_id: await this.client.getUserId(),
        });
    }
}
