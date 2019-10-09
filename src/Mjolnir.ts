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

import { LogService, MatrixClient, Permalinks } from "matrix-bot-sdk";
import BanList, { ALL_RULE_TYPES } from "./models/BanList";
import { applyServerAcls } from "./actions/ApplyAcl";
import { RoomUpdateError } from "./models/RoomUpdateError";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";
import { applyUserBans } from "./actions/ApplyBan";
import config from "./config";

export const STATE_NOT_STARTED = "not_started";
export const STATE_CHECKING_PERMISSIONS = "checking_permissions";
export const STATE_SYNCING = "syncing";
export const STATE_RUNNING = "running";

const WATCHED_LISTS_EVENT_TYPE = "org.matrix.mjolnir.watched_lists";

export class Mjolnir {

    private displayName: string;
    private localpart: string;
    private currentState: string = STATE_NOT_STARTED;

    constructor(
        public readonly client: MatrixClient,
        public readonly managementRoomId: string,
        public readonly protectedRooms: { [roomId: string]: string },
        private banLists: BanList[],
    ) {
        client.on("room.event", this.handleEvent.bind(this));

        client.on("room.message", async (roomId, event) => {
            if (roomId !== managementRoomId) return;
            if (!event['content']) return;

            const content = event['content'];
            if (content['msgtype'] === "m.text" && content['body']) {
                const prefixes = [COMMAND_PREFIX, this.localpart + ":", this.displayName + ":", await client.getUserId() + ":"];
                const prefixUsed = prefixes.find(p => content['body'].startsWith(p));
                if (!prefixUsed) return;

                // rewrite the event body to make the prefix uniform (in case the bot has spaces in its display name)
                event['content']['body'] = COMMAND_PREFIX + content['body'].substring(prefixUsed.length);

                await client.sendReadReceipt(roomId, event['event_id']);
                return handleCommand(roomId, event, this);
            }
        });

        client.getUserId().then(userId => {
            this.localpart = userId.split(':')[0].substring(1);
            return client.getUserProfile(userId);
        }).then(profile => {
            if (profile['displayname']) {
                this.displayName = profile['displayname'];
            }
        })
    }

    public get lists(): BanList[] {
        return this.banLists;
    }

    public get state(): string {
        return this.currentState;
    }

    public start() {
        return this.client.start().then(async () => {
            this.currentState = STATE_CHECKING_PERMISSIONS;
            if (config.verifyPermissionsOnStartup) {
                if (config.verboseLogging) {
                    await this.client.sendNotice(this.managementRoomId, "Checking permissions...");
                }
                await this.verifyPermissions(config.verboseLogging);
            }
        }).then(async () => {
            this.currentState = STATE_SYNCING;
            if (config.syncOnStartup) {
                if (config.verboseLogging) {
                    await this.client.sendNotice(this.managementRoomId, "Syncing lists...");
                }
                await this.buildWatchedBanLists();
                await this.syncLists(config.verboseLogging);
            }
        }).then(async () => {
            this.currentState = STATE_RUNNING;
            if (config.verboseLogging) {
                await this.client.sendNotice(this.managementRoomId, "Startup complete.");
            }
        });
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

            const list = new BanList(roomId, roomRef, this.client);
            await list.updateList();
            banLists.push(list);
        }

        this.banLists = banLists;
    }

    public async verifyPermissions(verbose = true) {
        const errors: RoomUpdateError[] = [];
        for (const roomId of Object.keys(this.protectedRooms)) {
            errors.push(...(await this.verifyPermissionsIn(roomId)));
        }

        const hadErrors = await this.printActionResult(errors, "Permission errors in protected rooms:");
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
                errors.push({roomId, errorMessage: `Missing power level for bans: ${userLevel} < ${ban}`});
            }
            if (userLevel < kick) {
                errors.push({roomId, errorMessage: `Missing power level for kicks: ${userLevel} < ${kick}`});
            }
            if (userLevel < redact) {
                errors.push({roomId, errorMessage: `Missing power level for redactions: ${userLevel} < ${redact}`});
            }
            if (userLevel < aclLevel) {
                errors.push({roomId, errorMessage: `Missing power level for server ACLs: ${userLevel} < ${aclLevel}`});
            }

            // Otherwise OK
        } catch (e) {
            LogService.error("Mjolnir", e);
            errors.push({roomId, errorMessage: e.message || (e.body ? e.body.error : '<no message>')});
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
            await this.client.sendMessage(this.managementRoomId, {
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
            await this.client.sendMessage(this.managementRoomId, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
        }
    }

    private async handleEvent(roomId: string, event: any) {
        if (!Object.keys(this.protectedRooms).includes(roomId)) return;

        if (event['type'] === 'm.room.power_levels' && event['state_key'] === '') {
            // power levels were updated - recheck permissions
            const url = this.protectedRooms[roomId];
            let html = `Power levels changed in <a href="${url}">${roomId}</a> - checking permissions...`;
            let text = `Power levels changed in ${url} - checking permissions...`;
            await this.client.sendMessage(this.managementRoomId, {
                msgtype: "m.notice",
                body: text,
                format: "org.matrix.custom.html",
                formatted_body: html,
            });
            const errors = await this.verifyPermissionsIn(roomId);
            const hadErrors = await this.printActionResult(errors);
            if (!hadErrors) {
                html = `<font color="#00cc00">All permissions look OK.</font>`;
                text = "All permissions look OK.";
                await this.client.sendMessage(this.managementRoomId, {
                    msgtype: "m.notice",
                    body: text,
                    format: "org.matrix.custom.html",
                    formatted_body: html,
                });
            }
            return;
        }

        if (!event['state_key']) return; // from here we don't do anything with events missing/empty state key

        if (ALL_RULE_TYPES.includes(event['type'])) {
            await this.syncListForRoom(roomId);
        } else if (event['type'] === "m.room.member") {
            const errors = await applyUserBans(this.banLists, Object.keys(this.protectedRooms), this);
            const hadErrors = await this.printActionResult(errors);

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
        } else return; // Not processed
    }

    private async printActionResult(errors: RoomUpdateError[], title: string = null) {
        if (errors.length <= 0) return false;

        let html = "";
        let text = "";

        const htmlTitle = title ? `${title}<br />` : '';
        const textTitle = title ? `${title}\n` : '';

        html += `<font color="#ff0000"><b>${htmlTitle}${errors.length} errors updating protected rooms!</b></font><br /><ul>`;
        text += `${textTitle}${errors.length} errors updating protected rooms!\n`;
        for (const error of errors) {
            const url = this.protectedRooms[error.roomId] ? this.protectedRooms[error.roomId] : `https://matrix.to/#/${error.roomId}`;
            html += `<li><a href="${url}">${error.roomId}</a> - ${error.errorMessage}</li>`;
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
}
