/*
Copyright 2019-2024 The Matrix.org Foundation C.I.C.

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
    MatrixEvent,
    MembershipEvent,
    MXCUrl,
    Permalinks,
    UserID,
} from "@vector-im/matrix-bot-sdk";

import { ALL_RULE_TYPES as ALL_BAN_LIST_RULE_TYPES } from "./models/ListRule";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";
import { UnlistedUserRedactionQueue } from "./queues/UnlistedUserRedactionQueue";
import { htmlEscape } from "./utils";
import { ReportManager } from "./report/ReportManager";
import { ReportPoller } from "./report/ReportPoller";
import { WebAPIs } from "./webapis/WebAPIs";
import RuleServer from "./models/RuleServer";
import { ThrottlingQueue } from "./queues/ThrottlingQueue";
import { getDefaultConfig, IConfig } from "./config";
import { PolicyListManager } from "./models/PolicyList";
import { ProtectedRoomsSet } from "./ProtectedRoomsSet";
import ManagementRoomOutput from "./ManagementRoomOutput";
import { ProtectionManager } from "./protections/ProtectionManager";
import { RoomMemberManager } from "./RoomMembers";
import ProtectedRoomsConfig from "./ProtectedRoomsConfig";
import { MatrixEmitter, MatrixSendClient } from "./MatrixEmitter";
import { OpenMetrics } from "./webapis/OpenMetrics";
import { LRUCache } from "lru-cache";
import { ModCache } from "./ModCache";
import { MASClient } from "./MASClient";
import { PluginManager } from "./plugins/PluginManager";
import "./commands/AddRemoveProtectedRoomsCommand";
import "./commands/AddRemoveRoomFromDirectoryCommand";
import "./commands/AliasCommands";
import "./commands/CreateBanListCommand";
import "./commands/DeactivateCommand";
import "./commands/DumpRulesCommand";
import "./commands/IgnoreCommand";
import "./commands/ImportCommand";
import "./commands/KickCommand";
import "./commands/ListProtectedRoomsCommand";
import "./commands/LockCommand";
import "./commands/MakeRoomAdminCommand";
import "./commands/MSC4284PolicyServerCommand";
import "./commands/PermissionCheckCommand";
import "./commands/ProtectionsCommands";
import "./commands/QuarantineMediaCommand";
import "./commands/RedactCommand";
import "./commands/SetDefaultBanListCommand";
import "./commands/SetPowerLevelCommand";
import "./commands/SetupDecentralizedReportingCommand";
import "./commands/ShutdownRoomCommand";
import "./commands/SinceCommand";
import "./commands/StatusCommand";
import "./commands/SuspendCommand";
import "./commands/SyncCommand";
import "./commands/UnbanBanCommand";
import "./commands/UnlockCommand";
import "./commands/UnsuspendCommand";
import "./commands/WatchUnwatchCommand";

export const STATE_NOT_STARTED = "not_started";
export const STATE_CHECKING_PERMISSIONS = "checking_permissions";
export const STATE_SYNCING = "syncing";
export const STATE_RUNNING = "running";

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

    public readonly protectedRoomsConfig: ProtectedRoomsConfig;
    public readonly protectedRoomsTracker: ProtectedRoomsSet;
    private webapis: WebAPIs;
    private openMetrics: OpenMetrics;
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
     * Manager for mjolnir plugins.
     */
    public readonly pluginManager: PluginManager;

    public readonly policyListManager: PolicyListManager;

    public readonly lastBotMentionForRoomId = new LRUCache<string, true>({
        ttl: 1000 * 60 * 8, // 8 minutes
        ttlAutopurge: true,
    });

    /**
     * Members of the moderator room and others who should not be banned, ACL'd etc.
     */
    public moderators: ModCache;

    /**
     * Whether the Synapse Mjolnir is protecting uses the Matrix Authentication Service
     */
    public readonly usingMAS: boolean;

    /**
     * Client for making calls to MAS (if using)
     */
    public MASClient: MASClient;

    /**
     * Adds a listener to the client that will automatically accept invitations.
     * @param {MatrixSendClient} client
     * @param options By default accepts invites from anyone.
     * @param {string} options.managementRoom The room to report ignored invitations to if `recordIgnoredInvites` is true.
     * @param {boolean} options.recordIgnoredInvites Whether to report invites that will be ignored to the `managementRoom`.
     * @param {boolean} options.autojoinOnlyIfManager Whether to only accept an invitation by a user present in the `managementRoom`.
     * @param {string} options.acceptInvitesFromSpace A space of users to accept invites from, ignores invites form users not in this space.
     */
    private static addJoinOnInviteListener(
        mjolnir: Mjolnir,
        client: MatrixSendClient,
        options: { [key: string]: any },
    ) {
        mjolnir.matrixEmitter.on("room.invite", async (roomId: string, inviteEvent: any) => {
            const membershipEvent = new MembershipEvent(inviteEvent);

            const reportInvite = async () => {
                if (!options.recordIgnoredInvites) return; // Nothing to do

                await client.sendMessage(mjolnir.managementRoomId, {
                    msgtype: "m.text",
                    body:
                        `${membershipEvent.sender} has invited me to ${roomId} but the config prevents me from accepting the invitation. ` +
                        `If you would like this room protected, use "!mjolnir rooms add ${roomId}" so I can accept the invite.`,
                    format: "org.matrix.custom.html",
                    formatted_body:
                        `${htmlEscape(membershipEvent.sender)} has invited me to ${htmlEscape(roomId)} but the config prevents me from ` +
                        `accepting the invitation. If you would like this room protected, use <code>!mjolnir rooms add ${htmlEscape(roomId)}</code> ` +
                        `so I can accept the invite.`,
                });
            };

            if (options.autojoinOnlyIfManager) {
                const managers = await client.getJoinedRoomMembers(mjolnir.managementRoomId);
                if (!managers.includes(membershipEvent.sender)) return reportInvite(); // ignore invite
            } else if (options.acceptInvitesFromSpace) {
                const spaceId = await client.resolveRoom(options.acceptInvitesFromSpace);
                const spaceUserIds = await client.getJoinedRoomMembers(spaceId).catch(async (e) => {
                    if (e.body?.errcode === "M_FORBIDDEN") {
                        await mjolnir.managementRoomOutput.logMessage(
                            LogLevel.ERROR,
                            "Mjolnir",
                            `Mjolnir is not in the space configured for acceptInvitesFromSpace, did you invite it?`,
                        );
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
     * @param {MatrixSendClient} client The client for Mjolnir to use.
     * @returns A new Mjolnir instance that can be started without further setup.
     */
    static async setupMjolnirFromConfig(
        client: MatrixSendClient,
        matrixEmitter: MatrixEmitter,
        config: IConfig,
    ): Promise<Mjolnir> {
        if (
            !config.autojoinOnlyIfManager &&
            config.acceptInvitesFromSpace === getDefaultConfig().acceptInvitesFromSpace
        ) {
            throw new TypeError(
                "`autojoinOnlyIfManager` has been disabled but you have not set `acceptInvitesFromSpace`. Please make it empty to accept invites from everywhere or give it a namespace alias or room id.",
            );
        }
        const joinedRooms = await client.getJoinedRooms();

        // Ensure we're also in the management room
        LogService.info("index", "Resolving management room...");
        const managementRoomId = await client.resolveRoom(config.managementRoom);
        if (!joinedRooms.includes(managementRoomId)) {
            await client.joinRoom(config.managementRoom);
        }

        const ruleServer = config.web.ruleServer ? new RuleServer() : null;
        const mjolnir = new Mjolnir(
            client,
            await client.getUserId(),
            matrixEmitter,
            managementRoomId,
            config,
            ruleServer,
        );
        await mjolnir.managementRoomOutput.logMessage(
            LogLevel.INFO,
            "index",
            "Mjolnir is starting up. Use !mjolnir to query status.",
        );
        Mjolnir.addJoinOnInviteListener(mjolnir, client, config);
        return mjolnir;
    }

    constructor(
        public readonly client: MatrixSendClient,
        private readonly clientUserId: string,
        public readonly matrixEmitter: MatrixEmitter,
        public readonly managementRoomId: string,
        public readonly config: IConfig,
        // Combines the rules from ban lists so they can be served to a homeserver module or another consumer.
        public readonly ruleServer: RuleServer | null,
    ) {
        this.protectedRoomsConfig = new ProtectedRoomsConfig(this.client);
        this.policyListManager = new PolicyListManager(this);
        this.pluginManager = new PluginManager(this);
        if (this.config.protectAllJoinedRooms) {
            LogService.warn(
                "Mjolnir",
                "Listening to all rooms, this can be very resource intensive and is not recommended.",
            );
        }
        this.roomJoins = new RoomMemberManager(this.client);
        this.protectedRoomsTracker = new ProtectedRoomsSet(
            this.protectedRoomsConfig,
            this.roomJoins,
            this.managementRoomId,
        );

        // Setup the protections
        this.protectionManager = new ProtectionManager(this);

        this.managementRoomOutput = new ManagementRoomOutput(
            this.managementRoomId,
            this.client,
            this.config,
            this.protectedRoomsTracker,
        );

        this.taskQueue = new ThrottlingQueue(this.config.backgroundDelayMS);
        this.moderators = new ModCache(this.client);

        this.reportManager = new ReportManager(this);
        if (this.config.pollReports) {
            this.reportPoller = new ReportPoller(this, this.reportManager);
        }

        if (this.config.health.openMetrics.enabled) {
            this.openMetrics = new OpenMetrics(this.config.health);
        }

        if (this.config.web.enabled) {
            this.webapis = new WebAPIs(this.reportManager, this.config, this.ruleServer);
        }

        if (this.config.MAS.use) {
            this.usingMAS = true;
            this.MASClient = new MASClient(this.config);
        }

        // Setup bot.
        this.localpart = new UserID(this.clientUserId).localpart;

        matrixEmitter.on("room.event", this.handleEvent.bind(this));

        matrixEmitter.on("room.message", async (roomId, event) => {
            const eventContent = event.content;
            if (typeof eventContent !== "object") return;

            const { event_id: eventId, sender } = event;
            const { msgtype, body: originalBody } = eventContent;

            if (msgtype !== "m.text" || typeof originalBody !== "string") {
                return;
            }
            if (this.config.forwardMentionsToManagementRoom && this.protectedRoomsTracker.isProtectedRoom(roomId)) {
                if (eventContent?.["m.mentions"]?.user_ids?.includes(this.clientUserId)) {
                    LogService.info("Mjolnir", `Bot mentioned ${roomId} by ${event.sender}`);
                    const permalink = Permalinks.forEvent(roomId, eventId, [new URL(this.config.homeserverUrl).hostname]);
                    this.lastBotMentionForRoomId.set(roomId, true);
                    await this.managementRoomOutput.logMessage(
                        LogLevel.INFO,
                        "Mjolnir",
                        `Received a mention from ${sender} in ${roomId}: ${originalBody} - ${permalink}`,
                    );
                }
            }
            if (roomId === this.managementRoomId) {
                const body = originalBody.trim();
                if (body.startsWith(COMMAND_PREFIX)) {
                    await handleCommand(roomId, new MatrixEvent(event), this);
                }
            }
        });
    }

    public get state(): string {
        return this.currentState;
    }

    public get unlistedUserRedactionHandler(): UnlistedUserRedactionQueue {
        return this.unlistedUserRedactionQueue;
    }

    public async start() {
        this.currentState = STATE_CHECKING_PERMISSIONS;
        await this.managementRoomOutput.logMessage(LogLevel.INFO, "Mjolnir", "Starting up, please wait...");

        // Ensure we can actually do things
        const anEvent = (
            await this.client.getRoomState(this.managementRoomId)
        ).find(e => e['type'] === 'm.room.name');
        const powerLevels = await this.client.getRoomStateEvent(this.managementRoomId, "m.room.power_levels", "");
        if (powerLevels['kick'] > (powerLevels['users_default'] || 0)) {
            LogService.warn("Mjolnir", `Cannot kick users in the management room. This may be because this Mjolnir is not an admin. Some commands may not work.`);
        }
        if (powerLevels['ban'] > (powerLevels['users_default'] || 0)) {
            LogService.warn("Mjolnir", `Cannot ban users in the management room. This may be because this Mjolnir is not an admin. Some commands may not work.`);
        }
        try {
            // Test permission by attempting to redact an event that doesn't exist.
            await this.client.redactEvent(this.managementRoomId, anEvent['event_id'] + 'not-a-real-event-id');
        } catch (e) {
            if (e.body?.errcode === 'M_FORBIDDEN') {
                LogService.warn("Mjolnir", `Cannot redact messages in the management room. This may be because this Mjolnir is not an admin. Some commands may not work.`);
            } else {
                LogService.warn("Mjolnir", "Error checking permissions within the management room", extractRequestError(e));
            }
        }

        this.displayName = (await this.client.getProfileInfo(this.clientUserId)).displayname || this.localpart;

        // Start the web server if enabled
        if (this.config.web.enabled) {
            await this.webapis.start();
        }

        if (this.ruleServer) {
            this.ruleServer.start(this.config.web.port, this.config.web.host, this.config.homeserverUrl);
        }

        if (this.config.health.openMetrics.enabled) {
            this.openMetrics.start();
        }

        this.currentState = STATE_SYNCING;
        // noinspection ES6MissingAwait - this is intentional.
        this.matrixEmitter.start().then(
            async () => {
                // This is a little complicated because we need to sync each list and then sync the rooms.
                // The protection manager depends on the policy list manager.
                // The policy list manager depends on the protected rooms config.
                await this.protectedRoomsConfig.load();
                await this.moderators.start();
                await this.policyListManager.start();
                await this.protectionManager.start();
                await this.pluginManager.start();
                await this.resyncJoinedRooms(false);
                this.reportManager.start();
                if (this.reportPoller) {
                    this.reportPoller.start();
                }

                this.currentState = STATE_RUNNING;
                await this.client.setDisplayName(this.displayName || this.localpart);
                await this.client.setAvatarUrl(this.config.avatarUrl);
                if (this.config.statusReportIntervalMinutes > 0) {
                    const statusReporting = () => {
                        this.managementRoomOutput.logMessage(LogLevel.DEBUG, "Mjolnir", "Status report:"
                            + ` I am currently in ${this.roomJoins.allJoinedRooms.length} rooms.`
                            + ` I am protecting ${this.protectedRoomsTracker.protectedRooms.length} rooms.`
                            + ` There are ${this.policyListManager.lists.length} lists being watched.`
                        );
                    };
                    setInterval(statusReporting, this.config.statusReportIntervalMinutes * 60 * 1000);
                }
            },
            (err) => {
                LogService.error("Mjolnir", "Error starting client. Exiting.", err);
                process.exit(1);
            },
        );
    }

    public stop() {
        this.matrixEmitter.stop();
        if (this.config.web.enabled) {
            this.webapis.stop();
        }
    }

    public get explicitlyProtectedRooms(): string[] {
        // We need to use the raw config here, otherwise we're just reading back the things
        // we've decided to protect.
        return this.protectedRoomsConfig.getProtectedRooms();
    }

    public async addProtectedRoom(roomId: string) {
        await this.protectedRoomsConfig.addProtectedRoom(roomId);
    }

    private protectRoom(roomId: string): void {
        this.protectedRoomsTracker.addProtectedRoom(roomId);
        this.roomJoins.addRoom(roomId);
        this.protectionManager.addRoom(roomId);
    }

    public async removeProtectedRoom(roomId: string) {
        await this.protectedRoomsConfig.removeProtectedRoom(roomId);
    }

    private unprotectRoom(roomId: string): void {
        this.protectedRoomsTracker.removeProtectedRoom(roomId);
        this.protectionManager.removeRoom(roomId);
        // We don't tell the roomJoins to leave because we might be in there for other reasons.
    }

    private async resyncJoinedRooms(withSync = true): Promise<void> {
        const filterOutManagementAndPolicyRooms = (roomId: string) => {
            return roomId !== this.managementRoomId && !this.policyListManager.lists.find(list => list.roomId === roomId);
        };

        if (withSync) {
            await this.matrixEmitter.start();
        }
        const joinedRooms = (await this.client.getJoinedRooms()).filter(filterOutManagementAndPolicyRooms);
        for (const roomId of joinedRooms) {
            this.roomJoins.addRoom(roomId);
        }

        const protectedRooms = this.protectedRoomsConfig.getProtectedRooms();
        for (const protectedRoomId of protectedRooms) {
            this.protectRoom(protectedRoomId);
        }

        if (this.config.protectAllJoinedRooms) {
            for (const roomId of joinedRooms) {
                if (!protectedRooms.includes(roomId)) {
                    this.protectRoom(roomId);
                }
            }
        }
    }

    private async handleEvent(roomId: string, event: any) {
        // We have to handle this first, otherwise we cry.
        if (roomId === this.managementRoomId) {
            const isMention =
                event.type === "m.room.message" &&
                (
                    (event.content?.formatted_body && event.content.formatted_body.includes(`https://matrix.to/#/${this.clientUserId}`))
                    || (event.content?.body && (event.content.body.includes(this.localpart) || event.content.body.includes(this.displayName)))
                )
            if (isMention) {
                this.lastBotMentionForRoomId.set(this.managementRoomId, true);
            }
        }

        // Check for UISI errors
        if (roomId === this.managementRoomId) {
            if (event["type"] === "m.room.message" && event["content"] && event["content"]["body"]) {
                if (
                    event["content"]["body"] ===
                    "** Unable to decrypt: The sender's device has not sent us the keys for this message. **"
                ) {
                    // UISI
                    await this.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "⚠");
                    await this.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "UISI");
                    await this.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "🚨");
                }
            }
        }

        // Check for updated ban lists before checking protected rooms - the ban lists might be protected
        // themselves.
        const policyList = this.policyListManager.lists.find((list) => list.roomId === roomId);
        if (policyList !== undefined) {
            if (ALL_BAN_LIST_RULE_TYPES.includes(event["type"]) || event["type"] === "m.room.redaction") {
                policyList.updateForEvent(event.event_id);
            }
        }

        if (await this.pluginManager.handleEvent(roomId, event)) {
            return;
        }
        if (await this.protectionManager.handleEvent(this, roomId, event)) {
            return;
        }

        if (event.sender !== this.clientUserId) {
            this.protectedRoomsTracker.handleEvent(roomId, event);
        }
    }

    public async isSynapseAdmin(): Promise<boolean> {
        // We can do this by checking if we can request /_synapse/admin/v1/users
        // using our access token. It's a bit of a hack, but it is what synapse-admin does.
        if (!this.config.adminApi.host) {
            throw new Error("Admin API host is not set");
        }
        try {
            await this.client.doRequest("GET", "/_synapse/admin/v1/users", {
                limit: 1
            });
            return true;
        } catch (e) {
            LogService.info("Mjolnir", "Error checking for synapse admin", extractRequestError(e));
            if (e.body?.errcode === 'M_FORBIDDEN' || e.body?.errcode === 'M_UNKNOWN_TOKEN') {
                return false;
            } else if (e.body?.errcode === 'M_UNKNOWN') {
                // This is what synapse returns when the endpoint doesn't exist.
                return false;
            } else {
                throw e;
            }
        }
    }

    public async deactivateSynapseUser(userId: string): Promise<any> {
        return this.client.doRequest("POST", `/_synapse/admin/v1/users/${userId}/deactivate`);
    }

    public async suspendSynapseUser(userId: string): Promise<any> {
        return this.client.doRequest("POST", `/_synapse/admin/v2/users/${userId}/suspend`);
    }

    public async unsuspendSynapseUser(userId: string): Promise<any> {
        return this.client.doRequest("POST", `/_synapse/admin/v2/users/${userId}/unsuspend`);
    }

    public async lockSynapseUser(userId: string): Promise<any> {
        return this.client.doRequest(
            "PUT",
            `/_synapse/admin/v1/users/${userId}/login`,
            undefined,
            { "type": "m.login.password", "locked": true }
        )
    }

    public async unlockSynapseUser(userId: string): Promise<any> {
        return this.client.doRequest(
            "PUT",
            `/_synapse/admin/v1/users/${userId}/login`,
            undefined,
            { "type": "m.login.password", "locked": false }
        )
    }

    public async shutdownSynapseRoom(roomId: string, message?: string): Promise<any> {
        return await this.client.doRequest("POST", `/_synapse/admin/v1/rooms/${roomId}/shutdown`, null, {
            new_room_user_id: this.clientUserId,
            block: true,
            message: message || "Room shut down by Mjolnir",
        });
    }

    public async makeUserRoomAdmin(roomId: string, userId?: string): Promise<any> {
        const target = userId ?? this.clientUserId;
        const powerLevels = await this.client.getRoomStateEvent(roomId, "m.room.power_levels", "");
        const currentPower = powerLevels.users?.[target] ?? powerLevels.users_default ?? 0;
        const adminPower = powerLevels.events?.['m.room.power_levels'] ?? powerLevels.state_default ?? 50;

        if (currentPower >= adminPower) {
            return; // Already admin
        }

        powerLevels.users[target] = adminPower;
        await this.client.sendStateEvent(roomId, "m.room.power_levels", "", powerLevels);
    }

    public async quarantineMedia(mxc: MXCUrl) {
        const [serverName, mediaId] = mxc.parts;
        return await this.client.doRequest("POST", `/_synapse/admin/v1/media/${serverName}/${mediaId}/quarantine`);
    }

    public async quarantineMediaForUser(userId: string): Promise<number> {
        const beforeTs = new Date().getTime();
        const data = await this.client.doRequest("GET", `/_synapse/admin/v1/users/${userId}/media`, { before_ts: beforeTs });

        const mediaIds = (data.media || []).filter(m => !m.quarantined).map(m => m.media_id);
        for (const mediaId of mediaIds) {
            await this.quarantineMedia(new MXCUrl(`mxc://${data.media_origin}/${mediaId}`));
        }

        return mediaIds.length;
    }

    public async findAssociatedRoom(alias: string): Promise<string> {
        const response = await this.client.resolveRoom(alias);
        return response.room_id;
    }
}
