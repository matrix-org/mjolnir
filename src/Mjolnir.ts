/*
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

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

import {
    CreateEvent,
    extractRequestError,
    LogLevel,
    LogService,
    MatrixClient,
    MatrixGlob,
    MembershipEvent,
    Permalinks,
    UserID,
    TextualMessageEventContent
} from "matrix-bot-sdk";

import BanList, { ALL_RULE_TYPES as ALL_BAN_LIST_RULE_TYPES, ListRuleChange, RULE_ROOM, RULE_SERVER, RULE_USER } from "./models/BanList";
import { applyServerAcls } from "./actions/ApplyAcl";
import { RoomUpdateError } from "./models/RoomUpdateError";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";
import { applyUserBans } from "./actions/ApplyBan";
import config from "./config";
import ErrorCache, { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "./ErrorCache";
import { Protection } from "./protections/IProtection";
import { PROTECTIONS } from "./protections/protections";
import { ConsequenceType, Consequence } from "./protections/consequence";
import { ProtectionSettingValidationError } from "./protections/ProtectionSettings";
import { UnlistedUserRedactionQueue } from "./queues/UnlistedUserRedactionQueue";
import { Healthz } from "./health/healthz";
import { EventRedactionQueue, RedactUserInRoom } from "./queues/EventRedactionQueue";
import { htmlEscape } from "./utils";
import { ReportManager } from "./report/ReportManager";
import { WebAPIs } from "./webapis/WebAPIs";
import { replaceRoomIdsWithPills } from "./utils";
import RuleServer from "./models/RuleServer";
import { RoomMemberManager } from "./RoomMembers";
import { ProtectedRoomActivityTracker } from "./queues/ProtectedRoomActivityTracker";

const levelToFn = {
    [LogLevel.DEBUG.toString()]: LogService.debug,
    [LogLevel.INFO.toString()]: LogService.info,
    [LogLevel.WARN.toString()]: LogService.warn,
    [LogLevel.ERROR.toString()]: LogService.error,
};

export const STATE_NOT_STARTED = "not_started";
export const STATE_CHECKING_PERMISSIONS = "checking_permissions";
export const STATE_SYNCING = "syncing";
export const STATE_RUNNING = "running";

const WATCHED_LISTS_EVENT_TYPE = "org.matrix.mjolnir.watched_lists";
const ENABLED_PROTECTIONS_EVENT_TYPE = "org.matrix.mjolnir.enabled_protections";
const PROTECTED_ROOMS_EVENT_TYPE = "org.matrix.mjolnir.protected_rooms";
const WARN_UNPROTECTED_ROOM_EVENT_PREFIX = "org.matrix.mjolnir.unprotected_room_warning.for.";
const CONSEQUENCE_EVENT_DATA = "org.matrix.mjolnir.consequence";

export class Mjolnir {
    private displayName: string;
    private localpart: string;
    private currentState: string = STATE_NOT_STARTED;
    public readonly roomJoins: RoomMemberManager;
    public protections = new Map<string /* protection name */, Protection>();
    /**
     * This is for users who are not listed on a watchlist,
     * but have been flagged by the automatic spam detection as suispicous
     */
    private unlistedUserRedactionQueue = new UnlistedUserRedactionQueue();
    /**
     * This is a queue for redactions to process after mjolnir
     * has finished applying ACL and bans when syncing.
     */
    private eventRedactionQueue = new EventRedactionQueue();
    private automaticRedactionReasons: MatrixGlob[] = [];
    /**
     * Every room that we are joined to except the management room. Used to implement `config.protectAllJoinedRooms`.
     */
    private protectedJoinedRoomIds: string[] = [];
    /**
     * These are rooms that were explicitly said to be protected either in the config, or by what is present in the account data for `org.matrix.mjolnir.protected_rooms`.
     */
    private explicitlyProtectedRoomIds: string[] = [];
    private unprotectedWatchedListRooms: string[] = [];
    private webapis: WebAPIs;
    private protectedRoomActivityTracker: ProtectedRoomActivityTracker;
    /**
     * Adds a listener to the client that will automatically accept invitations.
     * @param {MatrixClient} client
     * @param options By default accepts invites from anyone.
     * @param {string} options.managementRoom The room to report ignored invitations to if `recordIgnoredInvites` is true.
     * @param {boolean} options.recordIgnoredInvites Whether to report invites that will be ignored to the `managementRoom`.
     * @param {boolean} options.autojoinOnlyIfManager Whether to only accept an invitation by a user present in the `managementRoom`.
     * @param {string} options.acceptInvitesFromGroup A group of users to accept invites from, ignores invites form users not in this group.
     */
    private static addJoinOnInviteListener(mjolnir: Mjolnir, client: MatrixClient, options: { [key: string]: any }) {
        client.on("room.invite", async (roomId: string, inviteEvent: any) => {
            const membershipEvent = new MembershipEvent(inviteEvent);

            const reportInvite = async () => {
                if (!options.recordIgnoredInvites) return; // Nothing to do

                await client.sendMessage(mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body: `${membershipEvent.sender} has invited me to ${roomId} but the config prevents me from accepting the invitation. `
                        + `If you would like this room protected, use "!mjolnir rooms add ${roomId}" so I can accept the invite.`,
                    format: "org.matrix.custom.html",
                    formatted_body: `${htmlEscape(membershipEvent.sender)} has invited me to ${htmlEscape(roomId)} but the config prevents me from `
                        + `accepting the invitation. If you would like this room protected, use <code>!mjolnir rooms add ${htmlEscape(roomId)}</code> `
                        + `so I can accept the invite.`,
                });
            };

            if (options.autojoinOnlyIfManager) {
                const managers = await client.getJoinedRoomMembers(mjolnir.managementRoomId);
                if (!managers.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
            } else {
                const groupMembers = await client.unstableApis.getGroupUsers(options.acceptInvitesFromGroup);
                const userIds = groupMembers.map(m => m.user_id);
                if (!userIds.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
            }

            return client.joinRoom(roomId);
        });
    }

    /**
     * Create a new Mjolnir instance from a client and the options in the configuration file, ready to be started.
     * @param {MatrixClient} client The client for Mjolnir to use.
     * @returns A new Mjolnir instance that can be started without further setup.
     */
    static async setupMjolnirFromConfig(client: MatrixClient): Promise<Mjolnir> {
        const banLists: BanList[] = [];
        const protectedRooms: { [roomId: string]: string } = {};
        const joinedRooms = await client.getJoinedRooms();
        // Ensure we're also joined to the rooms we're protecting
        LogService.info("index", "Resolving protected rooms...");
        for (const roomRef of config.protectedRooms) {
            const permalink = Permalinks.parseUrl(roomRef);
            if (!permalink.roomIdOrAlias) continue;

            let roomId = await client.resolveRoom(permalink.roomIdOrAlias);
            if (!joinedRooms.includes(roomId)) {
                roomId = await client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
            }

            protectedRooms[roomId] = roomRef;
        }

        // Ensure we're also in the management room
        LogService.info("index", "Resolving management room...");
        const managementRoomId = await client.resolveRoom(config.managementRoom);
        if (!joinedRooms.includes(managementRoomId)) {
            await client.joinRoom(config.managementRoom);
        }

        const ruleServer = config.web.ruleServer ? new RuleServer() : null;
        const mjolnir = new Mjolnir(client, managementRoomId, protectedRooms, banLists, ruleServer);
        await mjolnir.logMessage(LogLevel.INFO, "index", "Mjolnir is starting up. Use !mjolnir to query status.");
        Mjolnir.addJoinOnInviteListener(mjolnir, client, config);
        return mjolnir;
    }

    constructor(
        public readonly client: MatrixClient,
        public readonly managementRoomId: string,
        /*
         * All the rooms that Mjolnir is protecting and their permalinks.
         * If `config.protectAllJoinedRooms` is specified, then `protectedRooms` will be all joined rooms except watched banlists that we can't protect (because they aren't curated by us).
         */
        public readonly protectedRooms: { [roomId: string]: string },
        private banLists: BanList[],
        // Combines the rules from ban lists so they can be served to a homeserver module or another consumer.
        public readonly ruleServer: RuleServer|null,
    ) {
        this.explicitlyProtectedRoomIds = Object.keys(this.protectedRooms);

        for (const reason of config.automaticallyRedactForReasons) {
            this.automaticRedactionReasons.push(new MatrixGlob(reason.toLowerCase()));
        }

        // Setup bot.

        client.on("room.event", this.handleEvent.bind(this));

        client.on("room.message", async (roomId, event) => {
            if (roomId !== this.managementRoomId) return;
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

                const prefixUsed = prefixes.find(p => content['body'].toLowerCase().startsWith(p.toLowerCase()));
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

        // Setup room activity watcher
        this.protectedRoomActivityTracker = new ProtectedRoomActivityTracker(client);

        // Setup Web APIs
        console.log("Creating Web APIs");
        const reportManager = new ReportManager(this);
        reportManager.on("report.new", this.handleReport.bind(this));
        this.webapis = new WebAPIs(reportManager, this.ruleServer);

        // Setup join/leave listener
        this.roomJoins = new RoomMemberManager(this.client);
    }

    public get lists(): BanList[] {
        return this.banLists;
    }

    public get state(): string {
        return this.currentState;
    }

    public get enabledProtections(): Protection[] {
        return [...this.protections.values()].filter(p => p.enabled);
    }

    /**
     * Returns the handler to flag a user for redaction, removing any future messages that they send.
     * Typically this is used by the flooding or image protection on users that have not been banned from a list yet.
     * It cannot used to redact any previous messages the user has sent, in that cas you should use the `EventRedactionQueue`.
     */
    public get unlistedUserRedactionHandler(): UnlistedUserRedactionQueue {
        return this.unlistedUserRedactionQueue;
    }

    public get automaticRedactGlobs(): MatrixGlob[] {
        return this.automaticRedactionReasons;
    }

    /**
     * Start Mjölnir.
     */
    public async start() {
        try {
            // Start the bot.
            await this.client.start();

            // Start the web server.
            console.log("Starting web server");
            await this.webapis.start();

            // Load the state.
            this.currentState = STATE_CHECKING_PERMISSIONS;

            await this.logMessage(LogLevel.DEBUG, "Mjolnir@startup", "Loading protected rooms...");
            await this.resyncJoinedRooms(false);
            try {
                const data: { rooms?: string[] } | null = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
                if (data && data['rooms']) {
                    for (const roomId of data['rooms']) {
                        this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
                        this.explicitlyProtectedRoomIds.push(roomId);
                        this.protectedRoomActivityTracker.addProtectedRoom(roomId);
                    }
                }
            } catch (e) {
                LogService.warn("Mjolnir", extractRequestError(e));
            }
            await this.buildWatchedBanLists();
            this.applyUnprotectedRooms();

            if (config.verifyPermissionsOnStartup) {
                await this.logMessage(LogLevel.INFO, "Mjolnir@startup", "Checking permissions...");
                await this.verifyPermissions(config.verboseLogging);
            }

            this.currentState = STATE_SYNCING;
            if (config.syncOnStartup) {
                await this.logMessage(LogLevel.INFO, "Mjolnir@startup", "Syncing lists...");
                await this.syncLists(config.verboseLogging);
                await this.registerProtections();
            }

            this.currentState = STATE_RUNNING;
            Healthz.isHealthy = true;
            await this.logMessage(LogLevel.INFO, "Mjolnir@startup", "Startup complete. Now monitoring rooms.");
        } catch (err) {
            try {
                LogService.error("Mjolnir", "Error during startup:");
                LogService.error("Mjolnir", extractRequestError(err));
                this.stop();
                await this.logMessage(LogLevel.ERROR, "Mjolnir@startup", "Startup failed due to error - see console");
                throw err;
            } catch (e) {
                LogService.error("Mjolnir", `Failed to report startup error to the management room: ${e}`);
                throw err;
            }
        }
    }

    /**
     * Stop Mjolnir from syncing and processing commands.
     */
    public stop() {
        LogService.info("Mjolnir", "Stopping Mjolnir...");
        this.client.stop();
        this.webapis.stop();
    }

    public async logMessage(level: LogLevel, module: string, message: string | any, additionalRoomIds: string[] | string | null = null, isRecursive = false): Promise<any> {
        if (!additionalRoomIds) additionalRoomIds = [];
        if (!Array.isArray(additionalRoomIds)) additionalRoomIds = [additionalRoomIds];

        if (config.RUNTIME.client && (config.verboseLogging || LogLevel.INFO.includes(level))) {
            let clientMessage = message;
            if (level === LogLevel.WARN) clientMessage = `⚠ | ${message}`;
            if (level === LogLevel.ERROR) clientMessage = `‼ | ${message}`;

            const client = config.RUNTIME.client;
            const managementRoomId = await client.resolveRoom(config.managementRoom);
            const roomIds = [managementRoomId, ...additionalRoomIds];

            let evContent: TextualMessageEventContent = {
                body: message,
                formatted_body: htmlEscape(message),
                msgtype: "m.notice",
                format: "org.matrix.custom.html",
            };
            if (!isRecursive) {
                evContent = await replaceRoomIdsWithPills(this, clientMessage, new Set(roomIds), "m.notice");
            }

            await client.sendMessage(managementRoomId, evContent);
        }

        levelToFn[level.toString()](module, message);
    }


    public async addProtectedRoom(roomId: string) {
        this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
        this.roomJoins.addRoom(roomId);
        this.protectedRoomActivityTracker.addProtectedRoom(roomId);

        const unprotectedIdx = this.unprotectedWatchedListRooms.indexOf(roomId);
        if (unprotectedIdx >= 0) this.unprotectedWatchedListRooms.splice(unprotectedIdx, 1);
        this.explicitlyProtectedRoomIds.push(roomId);

        let additionalProtectedRooms: { rooms?: string[] } | null = null;
        try {
            additionalProtectedRooms = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
        } catch (e) {
            LogService.warn("Mjolnir", extractRequestError(e));
        }
        const rooms = (additionalProtectedRooms?.rooms ?? []);
        rooms.push(roomId);
        await this.client.setAccountData(PROTECTED_ROOMS_EVENT_TYPE, { rooms: rooms });
        await this.syncLists(config.verboseLogging);
    }

    public async removeProtectedRoom(roomId: string) {
        delete this.protectedRooms[roomId];
        this.roomJoins.removeRoom(roomId);
        this.protectedRoomActivityTracker.removeProtectedRoom(roomId);

        const idx = this.explicitlyProtectedRoomIds.indexOf(roomId);
        if (idx >= 0) this.explicitlyProtectedRoomIds.splice(idx, 1);

        let additionalProtectedRooms: { rooms?: string[] } | null = null;
        try {
            additionalProtectedRooms = await this.client.getAccountData(PROTECTED_ROOMS_EVENT_TYPE);
        } catch (e) {
            LogService.warn("Mjolnir", extractRequestError(e));
        }
        additionalProtectedRooms = { rooms: additionalProtectedRooms?.rooms?.filter(r => r !== roomId) ?? [] };
        await this.client.setAccountData(PROTECTED_ROOMS_EVENT_TYPE, additionalProtectedRooms);
    }

    private async resyncJoinedRooms(withSync = true) {
        if (!config.protectAllJoinedRooms) return;

        const joinedRoomIds = (await this.client.getJoinedRooms()).filter(r => r !== this.managementRoomId);
        const oldRoomIdsSet = new Set(this.protectedJoinedRoomIds);
        const joinedRoomIdsSet = new Set(joinedRoomIds);
        // Remove every room id that we have joined from `this.protectedRooms`.
        for (const roomId of this.protectedJoinedRoomIds) {
            delete this.protectedRooms[roomId];
            this.protectedRoomActivityTracker.removeProtectedRoom(roomId);
            if (!joinedRoomIdsSet.has(roomId)) {
                this.roomJoins.removeRoom(roomId);
            }
        }
        this.protectedJoinedRoomIds = joinedRoomIds;
        // Add all joined rooms back to the permalink object
        for (const roomId of joinedRoomIds) {
            this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
            this.protectedRoomActivityTracker.addProtectedRoom(roomId);
            if (!oldRoomIdsSet.has(roomId)) {
                this.roomJoins.addRoom(roomId);
            }
        }

        this.applyUnprotectedRooms();

        if (withSync) {
            await this.syncLists(config.verboseLogging);
        }
    }

    /*
     * Take all the builtin protections, register them to set their enabled (or not) state and
     * update their settings with any saved non-default values
     */
    private async registerProtections() {
        for (const protection of PROTECTIONS) {
            try {
                await this.registerProtection(protection);
            } catch (e) {
                LogService.warn("Mjolnir", extractRequestError(e));
            }
        }
    }

    /*
     * Make a list of the names of enabled protections and save them in a state event
     */
    private async saveEnabledProtections() {
        const protections = this.enabledProtections.map(p => p.name);
        await this.client.setAccountData(ENABLED_PROTECTIONS_EVENT_TYPE, { enabled: protections });
    }
    /*
     * Enable a protection by name and persist its enable state in to a state event
     *
     * @param name The name of the protection whose settings we're enabling
     */
    public async enableProtection(name: string) {
        const protection = this.protections.get(name);
        if (protection !== undefined) {
            protection.enabled = true;
            await this.saveEnabledProtections();
        }
    }
    /*
     * Disable a protection by name and remove it from the persistent list of enabled protections
     *
     * @param name The name of the protection whose settings we're disabling
     */
    public async disableProtection(name: string) {
        const protection = this.protections.get(name);
        if (protection !== undefined) {
            protection.enabled = false;
            await this.saveEnabledProtections();
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
            savedSettings = await this.client.getRoomStateEvent(
                this.managementRoomId, 'org.matrix.mjolnir.setting', protectionName
            );
        } catch {
            // setting does not exist, return empty object
            return {};
        }

        const settingDefinitions = this.protections.get(protectionName)?.settings ?? {};
        const validatedSettings: { [setting: string]: any } = {}
        for (let [key, value] of Object.entries(savedSettings)) {
            if (
                    // is this a setting name with a known parser?
                    key in settingDefinitions
                    // is the datatype of this setting's value what we expect?
                    && typeof(settingDefinitions[key].value) === typeof(value)
                    // is this setting's value valid for the setting?
                    && settingDefinitions[key].validate(value)
            ) {
                validatedSettings[key] = value;
            } else {
                await this.logMessage(
                    LogLevel.WARN,
                    "getProtectionSetting",
                    `Tried to read ${protectionName}.${key} and got invalid value ${value}`
                );
            }
        }
        return validatedSettings;
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
        const protection = this.protections.get(protectionName);
        if (protection === undefined) {
            return;
        }

        const validatedSettings: { [setting: string]: any } = await this.getProtectionSettings(protectionName);

        for (let [key, value] of Object.entries(changedSettings)) {
            if (!(key in protection.settings)) {
                throw new ProtectionSettingValidationError(`Failed to find protection setting by name: ${key}`);
            }
            if (typeof(protection.settings[key].value) !== typeof(value)) {
                throw new ProtectionSettingValidationError(`Invalid type for protection setting: ${key} (${typeof(value)})`);
            }
            if (!protection.settings[key].validate(value)) {
                throw new ProtectionSettingValidationError(`Invalid value for protection setting: ${key} (${value})`);
            }
            validatedSettings[key] = value;
        }

        await this.client.sendStateEvent(
            this.managementRoomId, 'org.matrix.mjolnir.setting', protectionName, validatedSettings
        );
    }

    /*
     * Given a protection object; add it to our list of protections, set whether it is enabled
     * and update its settings with any saved non-default values.
     *
     * @param protection The protection object we want to register
     */
    public async registerProtection(protection: Protection) {
        this.protections.set(protection.name, protection)

        let enabledProtections: { enabled: string[] } | null = null;
        try {
            enabledProtections = await this.client.getAccountData(ENABLED_PROTECTIONS_EVENT_TYPE);
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
    }
    /*
     * Given a protection object; remove it from our list of protections.
     *
     * @param protection The protection object we want to unregister
     */
    public unregisterProtection(protectionName: string) {
        if (!(protectionName in this.protections)) {
            throw new Error("Failed to find protection by name: " + protectionName);
        }
        this.protections.delete(protectionName);
    }

    /**
     * Helper for constructing `BanList`s and making sure they have the right listeners set up.
     * @param roomId The room id for the `BanList`.
     * @param roomRef A reference (matrix.to URL) for the `BanList`.
     */
    private async addBanList(roomId: string, roomRef: string): Promise<BanList> {
        const list = new BanList(roomId, roomRef, this.client);
        this.ruleServer?.watch(list);
        list.on('BanList.batch', this.syncWithBanList.bind(this));
        await list.updateList();
        this.banLists.push(list);
        return list;
    }

    /**
     * Get a protection by name.
     *
     * @return If there is a protection with this name *and* it is enabled,
     * return the protection.
     */
    public getProtection(protectionName: string): Protection | null {
        return this.protections.get(protectionName) ?? null;
    }

    public async watchList(roomRef: string): Promise<BanList | null> {
        const joinedRooms = await this.client.getJoinedRooms();
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            await this.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
        }

        if (this.banLists.find(b => b.roomId === roomId)) return null;

        const list = await this.addBanList(roomId, roomRef);

        await this.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: this.banLists.map(b => b.roomRef),
        });

        await this.warnAboutUnprotectedBanListRoom(roomId);

        return list;
    }

    public async unwatchList(roomRef: string): Promise<BanList | null> {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
        const list = this.banLists.find(b => b.roomId === roomId) || null;
        if (list) {
            this.banLists.splice(this.banLists.indexOf(list), 1);
            this.ruleServer?.unwatch(list);
        }

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

        if (!this.unprotectedWatchedListRooms.includes(roomId)) this.unprotectedWatchedListRooms.push(roomId);
        this.applyUnprotectedRooms();

        try {
            const accountData: { warned: boolean } | null = await this.client.getAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId);
            if (accountData && accountData.warned) return; // already warned
        } catch (e) {
            // Ignore - probably haven't warned about it yet
        }

        await this.logMessage(LogLevel.WARN, "Mjolnir", `Not protecting ${roomId} - it is a ban list that this bot did not create. Add the room as protected if it is supposed to be protected. This warning will not appear again.`, roomId);
        await this.client.setAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId, { warned: true });
    }

    private applyUnprotectedRooms() {
        for (const roomId of this.unprotectedWatchedListRooms) {
            delete this.protectedRooms[roomId];
            this.protectedRoomActivityTracker.removeProtectedRoom(roomId);
        }
    }

    private async buildWatchedBanLists() {
        this.banLists = [];
        const joinedRooms = await this.client.getJoinedRooms();

        let watchedListsEvent: { references?: string[] } | null = null;
        try {
            watchedListsEvent = await this.client.getAccountData(WATCHED_LISTS_EVENT_TYPE);
        } catch (e) {
            // ignore - not important
        }

        for (const roomRef of (watchedListsEvent?.references || [])) {
            const permalink = Permalinks.parseUrl(roomRef);
            if (!permalink.roomIdOrAlias) continue;

            const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
            if (!joinedRooms.includes(roomId)) {
                await this.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
            }

            await this.warnAboutUnprotectedBanListRoom(roomId);
            await this.addBanList(roomId, roomRef);
        }
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
            await this.client.sendMessage(this.managementRoomId, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
    }

    private async verifyPermissionsIn(roomId: string): Promise<RoomUpdateError[]> {
        const errors: RoomUpdateError[] = [];
        const additionalPermissions = this.requiredProtectionPermissions();

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

    private requiredProtectionPermissions(): Set<string> {
        return new Set(this.enabledProtections.map((p) => p.requiredStatePermissions).flat())
    }

    /**
     * @returns The protected rooms ordered by the most recently active first.
     */
    public protectedRoomsByActivity(): string[] {
        return this.protectedRoomActivityTracker.protectedRoomsByActivity();
    }

    /**
     * Sync all the rooms with all the watched lists, banning and applying any changed ACLS.
     * @param verbose Whether to report any errors to the management room.
     */
    public async syncLists(verbose = true) {
        for (const list of this.banLists) {
            const changes = await list.updateList();
            await this.printBanlistChanges(changes, list, true);
        }

        let hadErrors = false;
        const [aclErrors, banErrors] = await Promise.all([
            applyServerAcls(this.banLists, this.protectedRoomsByActivity(), this),
            applyUserBans(this.banLists, this.protectedRoomsByActivity(), this)
        ]);
        const redactionErrors = await this.processRedactionQueue();
        hadErrors = hadErrors || await this.printActionResult(aclErrors, "Errors updating server ACLs:");
        hadErrors = hadErrors || await this.printActionResult(banErrors, "Errors updating member bans:");
        hadErrors = hadErrors || await this.printActionResult(redactionErrors, "Error updating redactions:");

        if (!hadErrors && verbose) {
            const html = `<font color="#00cc00">Done updating rooms - no errors</font>`;
            const text = "Done updating rooms - no errors";
            await this.client.sendMessage(this.managementRoomId, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
    }

    /**
     * Pulls any changes to the rules that are in a policy room and updates all protected rooms
     * with those changes. Does not fail if there are errors updating the room, these are reported to the management room.
     * @param banList The `BanList` which we will check for changes and apply them to all protected rooms.
     * @returns When all of the protected rooms have been updated.
     */
     private async syncWithBanList(banList: BanList): Promise<void> {
        const changes = await banList.updateList();

        let hadErrors = false;
        const [aclErrors, banErrors] = await Promise.all([
            applyServerAcls(this.banLists, this.protectedRoomsByActivity(), this),
            applyUserBans(this.banLists, this.protectedRoomsByActivity(), this)
        ]);
        const redactionErrors = await this.processRedactionQueue();
        hadErrors = hadErrors || await this.printActionResult(aclErrors, "Errors updating server ACLs:");
        hadErrors = hadErrors || await this.printActionResult(banErrors, "Errors updating member bans:");
        hadErrors = hadErrors || await this.printActionResult(redactionErrors, "Error updating redactions:");

        if (!hadErrors) {
            const html = `<font color="#00cc00"><b>Done updating rooms - no errors</b></font>`;
            const text = "Done updating rooms - no errors";
            await this.client.sendMessage(this.managementRoomId, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
        // This can fail if the change is very large and it is much less important than applying bans, so do it last.
        await this.printBanlistChanges(changes, banList, true);
    }

    private async handleConsequence(protection: Protection, roomId: string, eventId: string, sender: string, consequence: Consequence) {
        switch (consequence.type) {
            case ConsequenceType.alert:
                break;
            case ConsequenceType.redact:
                await this.client.redactEvent(roomId, eventId, "abuse detected");
                break;
            case ConsequenceType.ban:
                await this.client.banUser(sender, roomId, "abuse detected");
                break;
        }

        let message = `protection ${protection.name} enacting ${ConsequenceType[consequence.type]}`
            + ` against ${htmlEscape(sender)}`
            + ` in ${htmlEscape(roomId)}`;
        if (consequence.reason !== undefined) {
            // even though internally-sourced, there's no promise that `consequence.reason`
            // will never have user-supplied information, so escape it
            message += ` (reason: ${htmlEscape(consequence.reason)})`;
        }

        await this.client.sendMessage(this.managementRoomId, {
            msgtype: "m.notice",
            body: message,
            [CONSEQUENCE_EVENT_DATA]: {
                who: sender,
                room: roomId,
                type: ConsequenceType[consequence.type]
            }
        });
    }

    private async handleEvent(roomId: string, event: any) {
        // Check for UISI errors
        if (roomId === this.managementRoomId) {
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
        const banList = this.banLists.find(list => list.roomId === roomId);
        if (banList !== undefined) {
            if (ALL_BAN_LIST_RULE_TYPES.includes(event['type']) || event['type'] === 'm.room.redaction') {
                banList.updateForEvent(event)
            }
        }

        if (roomId in this.protectedRooms) {
            if (event['sender'] === await this.client.getUserId()) return; // Ignore ourselves

            // Iterate all the enabled protections
            for (const protection of this.enabledProtections) {
                let consequence: Consequence | undefined = undefined;
                try {
                    consequence = await protection.handleEvent(this, roomId, event);
                } catch (e) {
                    const eventPermalink = Permalinks.forEvent(roomId, event['event_id']);
                    LogService.error("Mjolnir", "Error handling protection: " + protection.name);
                    LogService.error("Mjolnir", "Failed event: " + eventPermalink);
                    LogService.error("Mjolnir", extractRequestError(e));
                    await this.client.sendNotice(this.managementRoomId, "There was an error processing an event through a protection - see log for details. Event: " + eventPermalink);
                    continue;
                }

                if (consequence !== undefined) {
                    await this.handleConsequence(protection, roomId, event["event_id"], event["sender"], consequence);
                }
            }

            // Run the event handlers - we always run this after protections so that the protections
            // can flag the event for redaction.
            await this.unlistedUserRedactionHandler.handleEvent(roomId, event, this);

            if (event['type'] === 'm.room.power_levels' && event['state_key'] === '') {
                // power levels were updated - recheck permissions
                ErrorCache.resetError(roomId, ERROR_KIND_PERMISSION);
                await this.logMessage(LogLevel.DEBUG, "Mjolnir", `Power levels changed in ${roomId} - checking permissions...`, roomId);
                const errors = await this.verifyPermissionsIn(roomId);
                const hadErrors = await this.printActionResult(errors);
                if (!hadErrors) {
                    await this.logMessage(LogLevel.DEBUG, "Mjolnir", `All permissions look OK.`);
                }
                return;
            } else if (event['type'] === "m.room.member") {
                // The reason we have to apply bans on each member change is because
                // we cannot eagerly ban users (that is to ban them when they have never been a member)
                // as they can be force joined to a room they might not have known existed.
                // Only apply bans and then redactions in the room we are currently looking at.
                const banErrors = await applyUserBans(this.banLists, [roomId], this);
                const redactionErrors = await this.processRedactionQueue(roomId);
                await this.printActionResult(banErrors);
                await this.printActionResult(redactionErrors);
            }
        }
    }

    /**
     * Print the changes to a banlist to the management room.
     * @param changes A list of changes that have been made to a particular ban list.
     * @param ignoreSelf Whether to exclude changes that have been made by Mjolnir.
     * @returns true if the message was sent, false if it wasn't (because there there were no changes to report).
     */
    private async printBanlistChanges(changes: ListRuleChange[], list: BanList, ignoreSelf = false): Promise<boolean> {
        if (ignoreSelf) {
            const sender = await this.client.getUserId();
            changes = changes.filter(change => change.sender !== sender);
        }
        if (changes.length <= 0) return false;

        let html = "";
        let text = "";

        const changesInfo = `updated with ${changes.length} ` + (changes.length === 1 ? 'change:' : 'changes:');
        const shortcodeInfo = list.listShortcode ? ` (shortcode: ${htmlEscape(list.listShortcode)})` : '';

        html += `<a href="${htmlEscape(list.roomRef)}">${htmlEscape(list.roomId)}</a>${shortcodeInfo} ${changesInfo}<br/><ul>`;
        text += `${list.roomRef}${shortcodeInfo} ${changesInfo}:\n`;

        for (const change of changes) {
            const rule = change.rule;
            let ruleKind: string = rule.kind;
            if (ruleKind === RULE_USER) {
                ruleKind = 'user';
            } else if (ruleKind === RULE_SERVER) {
                ruleKind = 'server';
            } else if (ruleKind === RULE_ROOM) {
                ruleKind = 'room';
            }
            html += `<li>${change.changeType} ${htmlEscape(ruleKind)} (<code>${htmlEscape(rule.recommendation ?? "")}</code>): <code>${htmlEscape(rule.entity)}</code> (${htmlEscape(rule.reason)})</li>`;
            text += `* ${change.changeType} ${ruleKind} (${rule.recommendation}): ${rule.entity} (${rule.reason})\n`;
        }

        const message = {
            msgtype: "m.notice",
            body: text,
            format: "org.matrix.custom.html",
            formatted_body: html,
        };
        await this.client.sendMessage(this.managementRoomId, message);
        return true;
    }

    private async printActionResult(errors: RoomUpdateError[], title: string | null = null, logAnyways = false) {
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
        await this.client.sendMessage(this.managementRoomId, message);
        return true;
    }

    public async isSynapseAdmin(): Promise<boolean> {
        try {
            const endpoint = `/_synapse/admin/v1/users/${await this.client.getUserId()}/admin`;
            const response = await this.client.doRequest("GET", endpoint);
            return response['admin'];
        } catch (e) {
            LogService.error("Mjolnir", "Error determining if Mjolnir is a server admin:");
            LogService.error("Mjolnir", extractRequestError(e));
            return false; // assume not
        }
    }

    public async deactivateSynapseUser(userId: string): Promise<any> {
        const endpoint = `/_synapse/admin/v1/deactivate/${userId}`;
        return await this.client.doRequest("POST", endpoint);
    }

    public async shutdownSynapseRoom(roomId: string, message?: string): Promise<any> {
        const endpoint = `/_synapse/admin/v1/rooms/${roomId}`;
        return await this.client.doRequest("DELETE", endpoint, null, {
            new_room_user_id: await this.client.getUserId(),
            block: true,
            message: message /* If `undefined`, we'll use Synapse's default message. */
        });
    }

    /**
     * Make a user administrator via the Synapse Admin API
     * @param roomId the room where the user (or the bot) shall be made administrator.
     * @param userId optionally specify the user mxID to be made administrator, if not specified the bot mxID will be used.
     * @returns The list of errors encountered, for reporting to the management room.
     */
    public async makeUserRoomAdmin(roomId: string, userId?: string): Promise<any> {
        try {
            const endpoint = `/_synapse/admin/v1/rooms/${roomId}/make_room_admin`;
            return await this.client.doRequest("POST", endpoint, null, {
                user_id: userId || await this.client.getUserId(), /* if not specified make the bot administrator */
            });
        } catch (e) {
            return extractRequestError(e);
        }
    }

    public queueRedactUserMessagesIn(userId: string, roomId: string) {
        this.eventRedactionQueue.add(new RedactUserInRoom(userId, roomId));
    }

    /**
     * Process all queued redactions, this is usually called at the end of the sync process,
     * after all users have been banned and ACLs applied.
     * If a redaction cannot be processed, the redaction is skipped and removed from the queue.
     * We then carry on processing the next redactions.
     * @param roomId Limit processing to one room only, otherwise process redactions for all rooms.
     * @returns The list of errors encountered, for reporting to the management room.
     */
    public async processRedactionQueue(roomId?: string): Promise<RoomUpdateError[]> {
        return await this.eventRedactionQueue.process(this, roomId);
    }

    private async handleReport(e: { roomId: string, reporterId: string, event: any, reason?: string }) {
        for (const protection of this.enabledProtections) {
            await protection.handleReport(this, e.roomId, e.reporterId, e.event, e.reason);
        }
    }
}
