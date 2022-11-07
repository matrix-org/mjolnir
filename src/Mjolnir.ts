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
    extractRequestError,
    LogLevel,
    LogService,
    MatrixClient,
    MembershipEvent,
    Permalinks,
} from "matrix-bot-sdk";

import { ALL_RULE_TYPES as ALL_BAN_LIST_RULE_TYPES } from "./models/ListRule";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";
import { UnlistedUserRedactionQueue } from "./queues/UnlistedUserRedactionQueue";
import { htmlEscape } from "./utils";
import { ReportManager } from "./report/ReportManager";
import { ReportPoller } from "./report/ReportPoller";
import { WebAPIs } from "./webapis/WebAPIs";
import RuleServer from "./models/RuleServer";
import { ThrottlingQueue } from "./queues/ThrottlingQueue";
import { IConfig } from "./config";
import PolicyList from "./models/PolicyList";
import { ProtectedRoomsSet } from "./ProtectedRoomsSet";
import ManagementRoomOutput from "./ManagementRoomOutput";
import { ProtectionManager } from "./protections/ProtectionManager";
import { RoomMemberManager } from "./RoomMembers";
import ProtectedRoomsConfig from "./ProtectedRoomsConfig";

export const STATE_NOT_STARTED = "not_started";
export const STATE_CHECKING_PERMISSIONS = "checking_permissions";
export const STATE_SYNCING = "syncing";
export const STATE_RUNNING = "running";

const WATCHED_LISTS_EVENT_TYPE = "org.matrix.mjolnir.watched_lists";
const WARN_UNPROTECTED_ROOM_EVENT_PREFIX = "org.matrix.mjolnir.unprotected_room_warning.for.";

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
    /**
     * This is for users who are not listed on a watchlist,
     * but have been flagged by the automatic spam detection as suispicous
     */
    private unlistedUserRedactionQueue = new UnlistedUserRedactionQueue();

    private protectedRoomsConfig: ProtectedRoomsConfig;
    public readonly protectedRoomsTracker: ProtectedRoomsSet;
    private webapis: WebAPIs;
    public taskQueue: ThrottlingQueue;
    /**
     * Reporting back to the management room.
     */
    public readonly managementRoomOutput: ManagementRoomOutput;
    /*
     * Config-enabled polling of reports in Synapse, so Mjolnir can react to reports
     */
    private reportPoller?: ReportPoller;
    /**
     * Store the protections being used by Mjolnir.
     */
    public readonly protectionManager: ProtectionManager;
    /**
     * Handle user reports from the homeserver.
     */
    public readonly reportManager: ReportManager;

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
                            await mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, 'Mjolnir', `Mjolnir is not in the space configured for acceptInvitesFromSpace, did you invite it?`);
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
        const joinedRooms = await client.getJoinedRooms();

        // Ensure we're also in the management room
        LogService.info("index", "Resolving management room...");
        const managementRoomId = await client.resolveRoom(config.managementRoom);
        if (!joinedRooms.includes(managementRoomId)) {
            await client.joinRoom(config.managementRoom);
        }

        const ruleServer = config.web.ruleServer ? new RuleServer() : null;
        const mjolnir = new Mjolnir(client, await client.getUserId(), managementRoomId, config, policyLists, ruleServer);
        await mjolnir.managementRoomOutput.logMessage(LogLevel.INFO, "index", "Mjolnir is starting up. Use !mjolnir to query status.");
        Mjolnir.addJoinOnInviteListener(mjolnir, client, config);
        return mjolnir;
    }

    constructor(
        public readonly client: MatrixClient,
        private readonly clientUserId: string,
        public readonly managementRoomId: string,
        public readonly config: IConfig,
        private policyLists: PolicyList[],
        // Combines the rules from ban lists so they can be served to a homeserver module or another consumer.
        public readonly ruleServer: RuleServer | null,
    ) {
        this.protectedRoomsConfig = new ProtectedRoomsConfig(client);

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
        this.reportManager = new ReportManager(this);
        this.webapis = new WebAPIs(this.reportManager, this.config, this.ruleServer);
        if (config.pollReports) {
            this.reportPoller = new ReportPoller(this, this.reportManager);
        }
        // Setup join/leave listener
        this.roomJoins = new RoomMemberManager(this.client);
        this.taskQueue = new ThrottlingQueue(this, config.backgroundDelayMS);

        this.protectionManager = new ProtectionManager(this);

        this.managementRoomOutput = new ManagementRoomOutput(managementRoomId, client, config);
        const protections = new ProtectionManager(this);
        this.protectedRoomsTracker = new ProtectedRoomsSet(client, clientUserId, managementRoomId, this.managementRoomOutput, protections, config);
    }

    public get lists(): PolicyList[] {
        return this.policyLists;
    }

    public get state(): string {
        return this.currentState;
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
                        this.managementRoomOutput.logMessage(LogLevel.INFO, "Mjolnir@startup", "report poll setting does not exist yet");
                    }
                }
                this.reportPoller.start(reportPollSetting.from);
            }

            // Load the state.
            this.currentState = STATE_CHECKING_PERMISSIONS;

            await this.managementRoomOutput.logMessage(LogLevel.DEBUG, "Mjolnir@startup", "Loading protected rooms...");
            await this.protectedRoomsConfig.loadProtectedRoomsFromConfig(this.config);
            await this.protectedRoomsConfig.loadProtectedRoomsFromAccountData();
            this.protectedRoomsConfig.getExplicitlyProtectedRooms().forEach(this.protectRoom, this);
            await this.resyncJoinedRooms(false);
            await this.buildWatchedPolicyLists();
            await this.protectionManager.start();

            if (this.config.verifyPermissionsOnStartup) {
                await this.managementRoomOutput.logMessage(LogLevel.INFO, "Mjolnir@startup", "Checking permissions...");
                await this.protectedRoomsTracker.verifyPermissions(this.config.verboseLogging);
            }

            // Start the bot.
            await this.client.start();

            this.currentState = STATE_SYNCING;
            if (this.config.syncOnStartup) {
                await this.managementRoomOutput.logMessage(LogLevel.INFO, "Mjolnir@startup", "Syncing lists...");
                await this.protectedRoomsTracker.syncLists(this.config.verboseLogging);
            }

            this.currentState = STATE_RUNNING;
            await this.managementRoomOutput.logMessage(LogLevel.INFO, "Mjolnir@startup", "Startup complete. Now monitoring rooms.");
        } catch (err) {
            try {
                LogService.error("Mjolnir", "Error during startup:");
                LogService.error("Mjolnir", extractRequestError(err));
                this.stop();
                await this.managementRoomOutput.logMessage(LogLevel.ERROR, "Mjolnir@startup", "Startup failed due to error - see console");
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

    /**
     * Rooms that mjolnir is configured to explicitly protect.
     * Do not use to access all of the rooms that mjolnir protects.
     * FIXME: In future ProtectedRoomsSet on this mjolnir should not be public and should also be accessed via a delegator method.
     */
    public get explicitlyProtectedRooms(): string[] {
        return this.protectedRoomsConfig.getExplicitlyProtectedRooms()
    }

    /**
     * Explicitly protect this room, adding it to the account data.
     * Should NOT be used to protect a room to implement e.g. `config.protectAllJoinedRooms`,
     * use `protectRoom` instead.
     * @param roomId The room to be explicitly protected by mjolnir and persisted in config.
     */
    public async addProtectedRoom(roomId: string) {
        await this.protectedRoomsConfig.addProtectedRoom(roomId);
        this.protectRoom(roomId);
    }

    /**
     * Protect the room, but do not persist it to the account data.
     * @param roomId The room to protect.
     */
    private protectRoom(roomId: string): void {
        this.protectedRoomsTracker.addProtectedRoom(roomId);
        this.roomJoins.addRoom(roomId);
    }

    /**
     * Remove a room from the explicitly protect set of rooms that is persisted to account data.
     * Should NOT be used to remove a room that we have left, e.g. when implementing `config.protectAllJoinedRooms`,
     * use `unprotectRoom` instead.
     * @param roomId The room to remove from account data and stop protecting.
     */
    public async removeProtectedRoom(roomId: string) {
        await this.protectedRoomsConfig.removeProtectedRoom(roomId);
        this.unprotectRoom(roomId);
    }

    /**
     * Unprotect a room.
     * @param roomId The room to stop protecting.
     */
    private unprotectRoom(roomId: string): void {
        this.roomJoins.removeRoom(roomId);
        this.protectedRoomsTracker.removeProtectedRoom(roomId);
    }

    public async addProtectedSpace(roomId: string): Promise<void> {
        await this.protectedRoomsConfig.addProtectedSpace(roomId);
        await this.protectSpace(roomId);
    }

    private async protectSpace(roomId: string): Promise<void> {
        // create a ProtectedSpace and keep that somewhere,
        // protected space could use ProtectedRoomSet for all its rooms.
        // don't bother with recursively following spaces yet, but we probably need something like
        // m.space.parent for that to work properly since anyone can add any room to spaces.
        //  
    }

    /**
     * Resynchronize the protected rooms with rooms that the mjolnir user is joined to.
     * This is to implement `config.protectAllJoinedRooms` functionality.
     * @param withSync Whether to synchronize all protected rooms with the watched policy lists afterwards.
     */
    private async resyncJoinedRooms(withSync = true): Promise<void> {
        if (!this.config.protectAllJoinedRooms) return;

        // We filter out all policy rooms so that we only protect ones that are
        // explicitly protected, so that we don't try to protect lists that we are just watching.
        const filterOutManagementAndPolicyRooms = (roomId: string) => {
            const policyListIds = this.policyLists.map(list => list.roomId);
            return roomId !== this.managementRoomId && !policyListIds.includes(roomId);
        };

        const joinedRoomIdsToProtect = new Set([
            ...(await this.client.getJoinedRooms()).filter(filterOutManagementAndPolicyRooms),
            // We do this specifically so policy lists that have been explicitly marked as protected
            // will be protected.
            ...this.protectedRoomsConfig.getExplicitlyProtectedRooms(),
        ]);
        const previousRoomIdsProtecting = new Set(this.protectedRoomsTracker.getProtectedRooms());
        // find every room that we have left (since last time)
        for (const roomId of previousRoomIdsProtecting.keys()) {
            if (!joinedRoomIdsToProtect.has(roomId)) {
                // Then we have left this room.
                this.unprotectRoom(roomId);
            }
        }
        // find every room that we have joined (since last time).
        for (const roomId of joinedRoomIdsToProtect.keys()) {
            if (!previousRoomIdsProtecting.has(roomId)) {
                // Then we have joined this room
                this.protectRoom(roomId);
            }
        }

        if (withSync) {
            await this.protectedRoomsTracker.syncLists(this.config.verboseLogging);
        }
    }


    /**
     * Helper for constructing `PolicyList`s and making sure they have the right listeners set up.
     * @param roomId The room id for the `PolicyList`.
     * @param roomRef A reference (matrix.to URL) for the `PolicyList`.
     */
    private async addPolicyList(roomId: string, roomRef: string): Promise<PolicyList> {
        const list = new PolicyList(roomId, roomRef, this.client);
        this.ruleServer?.watch(list);
        list.on('PolicyList.batch', (...args) => this.protectedRoomsTracker.syncWithPolicyList(...args));
        await list.updateList();
        this.policyLists.push(list);
        this.protectedRoomsTracker.watchList(list);
        return list;
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
            this.protectedRoomsTracker.unwatchList(list);
        }

        await this.client.setAccountData(WATCHED_LISTS_EVENT_TYPE, {
            references: this.policyLists.map(b => b.roomRef),
        });
        return list;
    }

    public async warnAboutUnprotectedPolicyListRoom(roomId: string) {
        if (!this.config.protectAllJoinedRooms) return; // doesn't matter
        if (this.protectedRoomsConfig.getExplicitlyProtectedRooms().includes(roomId)) return; // explicitly protected

        try {
            const accountData: { warned: boolean } | null = await this.client.getAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId);
            if (accountData && accountData.warned) return; // already warned
        } catch (e) {
            // Ignore - probably haven't warned about it yet
        }

        await this.managementRoomOutput.logMessage(LogLevel.WARN, "Mjolnir", `Not protecting ${roomId} - it is a ban list that this bot did not create. Add the room as protected if it is supposed to be protected. This warning will not appear again.`, roomId);
        await this.client.setAccountData(WARN_UNPROTECTED_ROOM_EVENT_PREFIX + roomId, { warned: true });
    }

    /**
     * Load the watched policy lists from account data, only used when Mjolnir is initialized.
     */
    private async buildWatchedPolicyLists() {
        this.policyLists = [];
        const joinedRooms = await this.client.getJoinedRooms();

        let watchedListsEvent: { references?: string[] } | null = null;
        try {
            watchedListsEvent = await this.client.getAccountData(WATCHED_LISTS_EVENT_TYPE);
        } catch (e) {
            if (e.statusCode === 404) {
                LogService.warn('Mjolnir', "Couldn't find account data for Mjolnir's watched lists, assuming first start.", extractRequestError(e));
            } else {
                throw e;
            }
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

        if (event.sender !== this.clientUserId) {
            this.protectedRoomsTracker.handleEvent(roomId, event);
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
}
