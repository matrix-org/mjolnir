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

import { ALL_RULE_TYPES as ALL_BAN_LIST_RULE_TYPES, RULE_ROOM, RULE_SERVER, RULE_USER } from "./models/ListRule";
import { applyServerAcls } from "./actions/ApplyAcl";
import { RoomUpdateError } from "./models/RoomUpdateError";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";
import { applyUserBans } from "./actions/ApplyBan";
import ErrorCache, { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "./ErrorCache";
import { Protection } from "./protections/IProtection";
import { PROTECTIONS } from "./protections/protections";
import { Consequence } from "./protections/consequence";
import { ProtectionSettingValidationError } from "./protections/ProtectionSettings";
import { UnlistedUserRedactionQueue } from "./queues/UnlistedUserRedactionQueue";
import { EventRedactionQueue, RedactUserInRoom } from "./queues/EventRedactionQueue";
import { htmlEscape } from "./utils";
import { ReportManager } from "./report/ReportManager";
import { ReportPoller } from "./report/ReportPoller";
import { WebAPIs } from "./webapis/WebAPIs";
import RuleServer from "./models/RuleServer";
import { RoomMemberManager } from "./RoomMembers";
import { ProtectedRoomActivityTracker } from "./queues/ProtectedRoomActivityTracker";
import { ThrottlingQueue } from "./queues/ThrottlingQueue";
import { IConfig } from "./config";
import PolicyList, { ListRuleChange } from "./models/PolicyList";
import { ProtectedRooms } from "./ProtectedRooms";
import ManagementRoomOutput from "./ManagementRoom";

export const STATE_NOT_STARTED = "not_started";
export const STATE_CHECKING_PERMISSIONS = "checking_permissions";
export const STATE_SYNCING = "syncing";
export const STATE_RUNNING = "running";

const WATCHED_LISTS_EVENT_TYPE = "org.matrix.mjolnir.watched_lists";
const ENABLED_PROTECTIONS_EVENT_TYPE = "org.matrix.mjolnir.enabled_protections";
const PROTECTED_ROOMS_EVENT_TYPE = "org.matrix.mjolnir.protected_rooms";
const WARN_UNPROTECTED_ROOM_EVENT_PREFIX = "org.matrix.mjolnir.unprotected_room_warning.for.";
const CONSEQUENCE_EVENT_DATA = "org.matrix.mjolnir.consequence";
/**
 * Synapse will tell us where we last got to on polling reports, so we need
 * to store that for pagination on further polls
 */
export const REPORT_POLL_EVENT_TYPE = "org.matrix.mjolnir.report_poll";

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
     * Every room that we are joined to except the management room. Used to implement `config.protectAllJoinedRooms`.
     */
    private protectedJoinedRoomIds: string[] = [];
    private protectedRoomsTracker: ProtectedRooms;
    /**
     * These are rooms that were explicitly said to be protected either in the config, or by what is present in the account data for `org.matrix.mjolnir.protected_rooms`.
     */
    private explicitlyProtectedRoomIds: string[] = [];
    private unprotectedWatchedListRooms: string[] = [];
    private webapis: WebAPIs;
    public taskQueue: ThrottlingQueue;
    private managementRoom: ManagementRoomOutput;
    /*
     * Config-enabled polling of reports in Synapse, so Mjolnir can react to reports
     */
    private reportPoller?: ReportPoller;
    /**
     * Adds a listener to the client that will automatically accept invitations.
     * @param {MatrixClient} client
     * @param options By default accepts invites from anyone.
     * @param {string} options.managementRoom The room to report ignored invitations to if `recordIgnoredInvites` is true.
     * @param {boolean} options.recordIgnoredInvites Whether to report invites that will be ignored to the `managementRoom`.
     * @param {boolean} options.autojoinOnlyIfManager Whether to only accept an invitation by a user present in the `managementRoom`.
     * @param {string} options.acceptInvitesFromSpace A space of users to accept invites from, ignores invites form users not in this space.
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
                const spaceId = await client.resolveRoom(options.acceptInvitesFromSpace);
                const spaceUserIds = await client.getJoinedRoomMembers(spaceId)
                    .catch(async e => {
                        if (e.body?.errcode === "M_FORBIDDEN") {
                            await mjolnir.logMessage(LogLevel.ERROR, 'Mjolnir', `Mjolnir is not in the space configured for acceptInvitesFromSpace, did you invite it?`);
                            await client.joinRoom(spaceId);
                            return await client.getJoinedRoomMembers(spaceId);
                        } else {
                            return Promise.reject(e);
                        }
                    });
                if (!spaceUserIds.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
            }

            return client.joinRoom(roomId);
        });
    }

    /**
     * Create a new Mjolnir instance from a client and the options in the configuration file, ready to be started.
     * @param {MatrixClient} client The client for Mjolnir to use.
     * @returns A new Mjolnir instance that can be started without further setup.
     */
    static async setupMjolnirFromConfig(client: MatrixClient, config: IConfig): Promise<Mjolnir> {
        const policyLists: PolicyList[] = [];
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
        const mjolnir = new Mjolnir(client, managementRoomId, config, protectedRooms, policyLists, ruleServer);
        await mjolnir.logMessage(LogLevel.INFO, "index", "Mjolnir is starting up. Use !mjolnir to query status.");
        Mjolnir.addJoinOnInviteListener(mjolnir, client, config);
        return mjolnir;
    }

    constructor(
        public readonly client: MatrixClient,
        public readonly managementRoomId: string,
        public readonly config: IConfig,
        /*
         * All the rooms that Mjolnir is protecting and their permalinks.
         * If `config.protectAllJoinedRooms` is specified, then `protectedRooms` will be all joined rooms except watched banlists that we can't protect (because they aren't curated by us).
         */
        public readonly protectedRooms: { [roomId: string]: string },
        private policyLists: PolicyList[],
        // Combines the rules from ban lists so they can be served to a homeserver module or another consumer.
        public readonly ruleServer: RuleServer | null,
    ) {
        this.explicitlyProtectedRoomIds = Object.keys(this.protectedRooms);

        for (const reason of this.config.automaticallyRedactForReasons) {
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

        // Setup Web APIs
        console.log("Creating Web APIs");
        const reportManager = new ReportManager(this);
        reportManager.on("report.new", this.handleReport.bind(this));
        this.webapis = new WebAPIs(reportManager, this.config, this.ruleServer);
        if (config.pollReports) {
            this.reportPoller = new ReportPoller(this, reportManager);
        }
        // Setup join/leave listener
        this.roomJoins = new RoomMemberManager(this.client);
        this.taskQueue = new ThrottlingQueue(this, config.backgroundDelayMS);
    }

    public get lists(): PolicyList[] {
        return this.policyLists;
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

            if (this.reportPoller) {
                let reportPollSetting: { from: number } = { from: 0 };
                try {
                    reportPollSetting = await this.client.getAccountData(REPORT_POLL_EVENT_TYPE);
                } catch (err) {
                    if (err.body?.errcode !== "M_NOT_FOUND") {
                        throw err;
                    } else {
                        this.managementRoom.logMessage(LogLevel.INFO, "Mjolnir@startup", "report poll setting does not exist yet");
                    }
                }
                this.reportPoller.start(reportPollSetting.from);
            }

            // Load the state.
            this.currentState = STATE_CHECKING_PERMISSIONS;

            await this.managementRoom.logMessage(LogLevel.DEBUG, "Mjolnir@startup", "Loading protected rooms...");
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
            await this.buildWatchedPolicyLists();
            this.applyUnprotectedRooms();

            if (this.config.verifyPermissionsOnStartup) {
                await this.managementRoom.logMessage(LogLevel.INFO, "Mjolnir@startup", "Checking permissions...");
                await this.verifyPermissions(this.config.verboseLogging);
            }

            this.currentState = STATE_SYNCING;
            if (this.config.syncOnStartup) {
                await this.managementRoom.logMessage(LogLevel.INFO, "Mjolnir@startup", "Syncing lists...");
                await this.syncLists(this.config.verboseLogging);
                await this.registerProtections();
            }

            this.currentState = STATE_RUNNING;
            await this.managementRoom.logMessage(LogLevel.INFO, "Mjolnir@startup", "Startup complete. Now monitoring rooms.");
        } catch (err) {
            try {
                LogService.error("Mjolnir", "Error during startup:");
                LogService.error("Mjolnir", extractRequestError(err));
                this.stop();
                await this.managementRoom.logMessage(LogLevel.ERROR, "Mjolnir@startup", "Startup failed due to error - see console");
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
        this.reportPoller?.stop();
    }

    public async addProtectedRoom(roomId: string) {
        this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
        this.roomJoins.addRoom(roomId);

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
    }

    public async removeProtectedRoom(roomId: string) {
        delete this.protectedRooms[roomId];
        this.roomJoins.removeRoom(roomId);

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

    // need to brewritten to add/remove from a ProtectedRooms instance.
    private async resyncJoinedRooms(withSync = true) {
        // this is really terrible!
        // what the fuck does it do???
        // just fix it bloody hell mate.
        if (!this.config.protectAllJoinedRooms) return;

        const joinedRoomIds = (await this.client.getJoinedRooms())
            .filter(r => r !== this.managementRoomId && !this.unprotectedWatchedListRooms.includes(r));
        const oldRoomIdsSet = new Set(this.protectedJoinedRoomIds);
        const joinedRoomIdsSet = new Set(joinedRoomIds);
        // find every room that we have left (since last time)
        for (const roomId of oldRoomIdsSet.keys()) {
            if (!joinedRoomIdsSet.has(roomId)) {
                // Then we have left this room.
                delete this.protectedRooms[roomId];
                this.protectedRoomsTracker.removeProtectedRoom(roomId);
                this.roomJoins.removeRoom(roomId);
            }
        }
        // find every room that we have joined (since last time).
        for (const roomId of joinedRoomIdsSet.keys()) {
            if (!oldRoomIdsSet.has(roomId)) {
                // Then we have joined this room
                this.roomJoins.addRoom(roomId);
                this.protectedRooms[roomId] = Permalinks.forRoom(roomId);
                await this.protectedRoomsTracker.addProtectedRoom(roomId);
            }
        }

        this.applyUnprotectedRooms();

        if (withSync) {
            await this.syncLists(this.config.verboseLogging);
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
                && typeof (settingDefinitions[key].value) === typeof (value)
                // is this setting's value valid for the setting?
                && settingDefinitions[key].validate(value)
            ) {
                validatedSettings[key] = value;
            } else {
                await this.managementRoom.logMessage(
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
            if (typeof (protection.settings[key].value) !== typeof (value)) {
                throw new ProtectionSettingValidationError(`Invalid type for protection setting: ${key} (${typeof (value)})`);
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
     * Helper for constructing `PolicyList`s and making sure they have the right listeners set up.
     * @param roomId The room id for the `PolicyList`.
     * @param roomRef A reference (matrix.to URL) for the `PolicyList`.
     */
    private async addPolicyList(roomId: string, roomRef: string): Promise<PolicyList> {
        const list = new PolicyList(roomId, roomRef, this.client);
        this.ruleServer?.watch(list);
        list.on('PolicyList.batch', this.syncWithPolicyList.bind(this));
        await list.updateList();
        this.policyLists.push(list);
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

    public async watchList(roomRef: string): Promise<PolicyList | null> {
        const joinedRooms = await this.client.getJoinedRooms();
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
        if (!joinedRooms.includes(roomId)) {
            await this.client.joinRoom(permalink.roomIdOrAlias, permalink.viaServers);
        }

        if (this.policyLists.find(b => b.roomId === roomId)) return null;

        const list = await this.addPolicyList(roomId, roomRef);

        await this.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: this.policyLists.map(b => b.roomRef),
        });

        await this.warnAboutUnprotectedPolicyListRoom(roomId);

        return list;
    }

    public async unwatchList(roomRef: string): Promise<PolicyList | null> {
        const permalink = Permalinks.parseUrl(roomRef);
        if (!permalink.roomIdOrAlias) return null;

        const roomId = await this.client.resolveRoom(permalink.roomIdOrAlias);
        const list = this.policyLists.find(b => b.roomId === roomId) || null;
        if (list) {
            this.policyLists.splice(this.policyLists.indexOf(list), 1);
            this.ruleServer?.unwatch(list);
        }

        await this.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: this.policyLists.map(b => b.roomRef),
        });
        return list;
    }

    public async warnAboutUnprotectedPolicyListRoom(roomId: string) {
        if (!this.config.protectAllJoinedRooms) return; // doesn't matter
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

        await this.managementRoom.logMessage(LogLevel.WARN, "Mjolnir", `Not protecting ${roomId} - it is a ban list that this bot did not create. Add the room as protected if it is supposed to be protected. This warning will not appear again.`, roomId);
        await this.client.setAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId, { warned: true });
    }

    private applyUnprotectedRooms() {
        for (const roomId of this.unprotectedWatchedListRooms) {
            delete this.protectedRooms[roomId];
            this.protectedRoomActivityTracker.removeProtectedRoom(roomId);
        }
    }

    private async buildWatchedPolicyLists() {
        this.policyLists = [];
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

            await this.warnAboutUnprotectedPolicyListRoom(roomId);
            await this.addPolicyList(roomId, roomRef);
        }
    }



    private requiredProtectionPermissions(): Set<string> {
        return new Set(this.enabledProtections.map((p) => p.requiredStatePermissions).flat())
    }

    private async handleConsequences(protection: Protection, roomId: string, eventId: string, sender: string, consequences: Consequence[]) {
        for (const consequence of consequences) {
            try {
                if (consequence.name === "alert") {
                    /* take no additional action, just print the below message to management room */
                } else if (consequence.name === "ban") {
                    await this.client.banUser(sender, roomId, "abuse detected");
                } else if (consequence.name === "redact") {
                    await this.client.redactEvent(roomId, eventId, "abuse detected");
                } else {
                    throw new Error(`unknown consequence ${consequence.name}`);
                }

                let message = `protection ${protection.name} enacting`
                    + ` ${consequence.name}`
                    + ` against ${htmlEscape(sender)}`
                    + ` in ${htmlEscape(roomId)}`
                    + ` (reason: ${htmlEscape(consequence.reason)})`;
                await this.client.sendMessage(this.managementRoomId, {
                    msgtype: "m.notice",
                    body: message,
                    [CONSEQUENCE_EVENT_DATA]: {
                        who: sender,
                        room: roomId,
                        types: [consequence.name],
                    }
                });
            } catch (e) {
                await this.logMessage(LogLevel.ERROR, "handleConsequences", `Failed to enact ${consequence.name} consequence: ${e}`);
            }
        }
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
        const policyList = this.policyLists.find(list => list.roomId === roomId);
        if (policyList !== undefined) {
            if (ALL_BAN_LIST_RULE_TYPES.includes(event['type']) || event['type'] === 'm.room.redaction') {
                policyList.updateForEvent(event.event_id)
            }
        }

        if (roomId in this.protectedRooms) {
            if (event['sender'] === await this.client.getUserId()) return; // Ignore ourselves

            // Iterate all the enabled protections
            for (const protection of this.enabledProtections) {
                let consequences: Consequence[] | undefined = undefined;
                try {
                    consequences = await protection.handleEvent(this, roomId, event);
                } catch (e) {
                    const eventPermalink = Permalinks.forEvent(roomId, event['event_id']);
                    LogService.error("Mjolnir", "Error handling protection: " + protection.name);
                    LogService.error("Mjolnir", "Failed event: " + eventPermalink);
                    LogService.error("Mjolnir", extractRequestError(e));
                    await this.client.sendNotice(this.managementRoomId, "There was an error processing an event through a protection - see log for details. Event: " + eventPermalink);
                    continue;
                }

                if (consequences !== undefined) {
                    await this.handleConsequences(protection, roomId, event["event_id"], event["sender"], consequences);
                }
            }

            // Run the event handlers - we always run this after protections so that the protections
            // can flag the event for redaction.
            await this.unlistedUserRedactionHandler.handleEvent(roomId, event, this);


        }
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

    private async handleReport({ roomId, reporterId, event, reason }: { roomId: string, reporterId: string, event: any, reason?: string }) {
        for (const protection of this.enabledProtections) {
            await protection.handleReport(this, roomId, reporterId, event, reason);
        }
    }
}
