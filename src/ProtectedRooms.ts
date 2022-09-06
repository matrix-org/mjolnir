/*
Copyright 2019, 2022 The Matrix.org Foundation C.I.C.

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

import { LogLevel, LogService, MatrixClient, MatrixGlob, Permalinks, UserID } from "matrix-bot-sdk";
import { IConfig } from "./config";
import ErrorCache, { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "./ErrorCache";
import ManagementRoomOutput from "./ManagementRoom";
import { RULE_ROOM, RULE_SERVER, RULE_USER } from "./models/ListRule";
import PolicyList, { ListRuleChange } from "./models/PolicyList";
import { RoomUpdateError } from "./models/RoomUpdateError";
import { ServerAcl } from "./models/ServerAcl";
import { ProtectionManager } from "./protections/protections";
import { EventRedactionQueue, RedactUserInRoom } from "./queues/EventRedactionQueue";
import { ProtectedRoomActivityTracker } from "./queues/ProtectedRoomActivityTracker";
import { htmlEscape } from "./utils";

/**
 * When you consider spaces https://github.com/matrix-org/mjolnir/issues/283
 * rather than indexing rooms via some collection, you instead have rooms
 * and then you find out which lists apply to them.
 * This is important because right now we have a collection of rooms
 * and implicitly a bunch of lists.
 * 
 * It's important not to tie this to the one group of rooms that a mjolnir may watch too much
 * as in future we might want to borrow this class to represent a space.
 */
export class ProtectedRooms {

    private protectedRooms = new Set</* room id */string>();

    private policyLists: PolicyList[];

    private protectedRoomActivityTracker: ProtectedRoomActivityTracker;

    /**
     * This is a queue for redactions to process after mjolnir
     * has finished applying ACL and bans when syncing.
     */
    private readonly eventRedactionQueue = new EventRedactionQueue();

    private readonly errorCache = new ErrorCache();

    private automaticRedactionReasons: MatrixGlob[] = [];

    /**
     * Used to provide mutual exclusion when synchronizing rooms with the state of a policy list.
     * This is because requests operating with rules from an older version of the list that are slow
     * could race & give the room an inconsistent state. An example is if we add multiple m.policy.rule.server rules,
     * which would cause several requests to a room to send a new m.room.server_acl event.
     * These requests could finish in any order, which has left rooms with an inconsistent server_acl event
     * until Mjolnir synchronises the room with its policy lists again, which can be in the region of hours.
     */
    private aclChain: Promise<void> = Promise.resolve();

    constructor(
        private readonly client: MatrixClient,
        private readonly clientUserId: string,
        private readonly managementRoomId: string,
        private readonly managementRoom: ManagementRoomOutput,
        private readonly protections: ProtectionManager,
        private readonly config: IConfig,
    ) {
        for (const reason of this.config.automaticallyRedactForReasons) {
            this.automaticRedactionReasons.push(new MatrixGlob(reason.toLowerCase()));
        }

        // Setup room activity watcher
        this.protectedRoomActivityTracker = new ProtectedRoomActivityTracker(client);
    }

    public queueRedactUserMessagesIn(userId: string, roomId: string) {
        this.eventRedactionQueue.add(new RedactUserInRoom(userId, roomId));
    }

    public get automaticRedactGlobs(): MatrixGlob[] {
        return this.automaticRedactionReasons;
    }

    public getProtectedRooms () {
        return [...this.protectedRooms.keys()]
    }

    public isProtectedRoom(roomId: string): boolean {
        return this.protectedRooms.has(roomId);
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
        return await this.eventRedactionQueue.process(this.client, this.managementRoom, roomId);
    }

    /**
     * @returns The protected rooms ordered by the most recently active first.
     */
    public protectedRoomsByActivity(): string[] {
        return this.protectedRoomActivityTracker.protectedRoomsByActivity();
    }

    public async handleEvent(roomId: string, event: any) {
        if (event['sender'] === this.clientUserId) {
            throw new TypeError("`ProtectedRooms::handleEvent` should not be used to inform about events sent by mjolnir.");
        }
        if (event['type'] === 'm.room.power_levels' && event['state_key'] === '') {
            // power levels were updated - recheck permissions
            this.errorCache.resetError(roomId, ERROR_KIND_PERMISSION);
            await this.managementRoom.logMessage(LogLevel.DEBUG, "Mjolnir", `Power levels changed in ${roomId} - checking permissions...`, roomId);
            const errors = await this.protections.verifyPermissionsIn(roomId);
            const hadErrors = await this.printActionResult(errors);
            if (!hadErrors) {
                await this.managementRoom.logMessage(LogLevel.DEBUG, "Mjolnir", `All permissions look OK.`);
            }
            return;
        } else if (event['type'] === "m.room.member") {
            // The reason we have to apply bans on each member change is because
            // we cannot eagerly ban users (that is to ban them when they have never been a member)
            // as they can be force joined to a room they might not have known existed.
            // Only apply bans and then redactions in the room we are currently looking at.
            const banErrors = await this.applyUserBans(this.policyLists, [roomId]);
            const redactionErrors = await this.processRedactionQueue(roomId);
            await this.printActionResult(banErrors);
            await this.printActionResult(redactionErrors);
        }
    }

    /**
     * Sync all the rooms with all the watched lists, banning and applying any changed ACLS.
     * @param verbose Whether to report any errors to the management room.
     */
    public async syncLists(verbose = true) {
        for (const list of this.policyLists) {
            const changes = await list.updateList();
            await this.printBanlistChanges(changes, list, true);
        }

        let hadErrors = false;
        const [aclErrors, banErrors] = await Promise.all([
            this.applyServerAcls(this.policyLists, this.protectedRoomsByActivity()),
            this.applyUserBans(this.policyLists, this.protectedRoomsByActivity())
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

    public async addProtectedRoom(roomId: string): Promise<void> {
        if (this.protectedRooms.has(roomId)) {
            // we need to protect ourselves form syncing all the lists unnecessarily
            // as Mjolnir does call this method repeatedly.
            return;
        }
        this.protectedRooms.add(roomId);
        this.protectedRoomActivityTracker.addProtectedRoom(roomId);
        await this.syncLists(this.config.verboseLogging);
    }

    public removeProtectedRoom(roomId: string): void {
        this.protectedRoomActivityTracker.removeProtectedRoom(roomId);
        this.protectedRooms.delete(roomId);
    }

    /**
     * Pulls any changes to the rules that are in a policy room and updates all protected rooms
     * with those changes. Does not fail if there are errors updating the room, these are reported to the management room.
     * @param policyList The `PolicyList` which we will check for changes and apply them to all protected rooms.
     * @returns When all of the protected rooms have been updated.
     */
    public async syncWithPolicyList(policyList: PolicyList): Promise<void> {
        // this bit can move away into a listener.
        const changes = await policyList.updateList();

        let hadErrors = false;
        const [aclErrors, banErrors] = await Promise.all([
            this.applyServerAcls(this.policyLists, this.protectedRoomsByActivity()),
            this.applyUserBans(this.policyLists, this.protectedRoomsByActivity())
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
        await this.printBanlistChanges(changes, policyList, true);
    }

    /**
     * Applies the server ACLs represented by the ban lists to the provided rooms, returning the
     * room IDs that could not be updated and their error.
     * Does not update the banLists before taking their rules to build the server ACL.
     * @param {PolicyList[]} lists The lists to construct ACLs from.
     * @param {string[]} roomIds The room IDs to apply the ACLs in.
     * @param {Mjolnir} mjolnir The Mjolnir client to apply the ACLs with.
     */
    private async applyServerAcls(lists: PolicyList[], roomIds: string[]): Promise<RoomUpdateError[]> {
        // we need to provide mutual exclusion so that we do not have requests updating the m.room.server_acl event
        // finish out of order and therefore leave the room out of sync with the policy lists.
        return new Promise((resolve, reject) => {
            this.aclChain = this.aclChain
                .then(() => this._applyServerAcls(lists, roomIds))
                .then(resolve, reject);
        });
    }

    private async _applyServerAcls(lists: PolicyList[], roomIds: string[]): Promise<RoomUpdateError[]> {
    const serverName: string = new UserID(await this.client.getUserId()).domain;

    // Construct a server ACL first
    const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*");
    for (const list of lists) {
        for (const rule of list.serverRules) {
            acl.denyServer(rule.entity);
        }
    }

    const finalAcl = acl.safeAclContent();

    if (finalAcl.deny.length !== acl.literalAclContent().deny.length) {
        this.managementRoom.logMessage(LogLevel.WARN, "ApplyAcl", `Mjölnir has detected and removed an ACL that would exclude itself. Please check the ACL lists.`);
    }

    if (this.config.verboseLogging) {
        // We specifically use sendNotice to avoid having to escape HTML
        await this.client.sendNotice(this.managementRoomId, `Constructed server ACL:\n${JSON.stringify(finalAcl, null, 2)}`);
    }

    const errors: RoomUpdateError[] = [];
    for (const roomId of roomIds) {
        try {
            await this.managementRoom.logMessage(LogLevel.DEBUG, "ApplyAcl", `Checking ACLs for ${roomId}`, roomId);

            try {
                const currentAcl = await this.client.getRoomStateEvent(roomId, "m.room.server_acl", "");
                if (acl.matches(currentAcl)) {
                    await this.managementRoom.logMessage(LogLevel.DEBUG, "ApplyAcl", `Skipping ACLs for ${roomId} because they are already the right ones`, roomId);
                    continue;
                }
            } catch (e) {
                // ignore - assume no ACL
            }

            // We specifically use sendNotice to avoid having to escape HTML
            await this.managementRoom.logMessage(LogLevel.DEBUG, "ApplyAcl", `Applying ACL in ${roomId}`, roomId);

            if (!this.config.noop) {
                await this.client.sendStateEvent(roomId, "m.room.server_acl", "", finalAcl);
            } else {
                await this.managementRoom.logMessage(LogLevel.WARN, "ApplyAcl", `Tried to apply ACL in ${roomId} but Mjolnir is running in no-op mode`, roomId);
            }
        } catch (e) {
            const message = e.message || (e.body ? e.body.error : '<no message>');
            const kind = message && message.includes("You don't have permission to post that to the room") ? ERROR_KIND_PERMISSION : ERROR_KIND_FATAL;
            errors.push({ roomId, errorMessage: message, errorKind: kind });
        }
    }

    return errors;
}

    /**
    * Applies the member bans represented by the ban lists to the provided rooms, returning the
     * room IDs that could not be updated and their error.
     * @param {PolicyList[]} lists The lists to determine bans from.
     * @param {string[]} roomIds The room IDs to apply the bans in.
     * @param {Mjolnir} mjolnir The Mjolnir client to apply the bans with.
     */
    private async applyUserBans(lists: PolicyList[], roomIds: string[]): Promise<RoomUpdateError[]> {
        // We can only ban people who are not already banned, and who match the rules.
        const errors: RoomUpdateError[] = [];
        for (const roomId of roomIds) {
            try {
                // We specifically use sendNotice to avoid having to escape HTML
                await this.managementRoom.logMessage(LogLevel.DEBUG, "ApplyBan", `Updating member bans in ${roomId}`, roomId);

                let members: { userId: string, membership: string }[];

                if (this.config.fasterMembershipChecks) {
                    const memberIds = await this.client.getJoinedRoomMembers(roomId);
                    members = memberIds.map(u => {
                        return { userId: u, membership: "join" };
                    });
                } else {
                    const state = await this.client.getRoomState(roomId);
                    members = state.filter(s => s['type'] === 'm.room.member' && !!s['state_key']).map(s => {
                        return { userId: s['state_key'], membership: s['content'] ? s['content']['membership'] : 'leave' };
                    });
                }

                for (const member of members) {
                    if (member.membership === 'ban') {
                        continue; // user already banned
                    }

                    let banned = false;
                    for (const list of lists) {
                        for (const userRule of list.userRules) {
                            if (userRule.isMatch(member.userId)) {
                                // User needs to be banned

                                // We specifically use sendNotice to avoid having to escape HTML
                                await this.managementRoom.logMessage(LogLevel.INFO, "ApplyBan", `Banning ${member.userId} in ${roomId} for: ${userRule.reason}`, roomId);

                                if (!this.config.noop) {
                                    await this.client.banUser(member.userId, roomId, userRule.reason);
                                    if (this.automaticRedactGlobs.find(g => g.test(userRule.reason.toLowerCase()))) {
                                        this.queueRedactUserMessagesIn(member.userId, roomId);
                                    }
                                } else {
                                    await this.managementRoom.logMessage(LogLevel.WARN, "ApplyBan", `Tried to ban ${member.userId} in ${roomId} but Mjolnir is running in no-op mode`, roomId);
                                }

                                banned = true;
                                break;
                            }
                        }
                        if (banned) break;
                    }
                }
            } catch (e) {
                const message = e.message || (e.body ? e.body.error : '<no message>');
                errors.push({
                    roomId,
                    errorMessage: message,
                    errorKind: message && message.includes("You don't have permission to ban") ? ERROR_KIND_PERMISSION : ERROR_KIND_FATAL,
                });
            }
        }

        return errors;
    }

    /**
     * Print the changes to a banlist to the management room.
     * @param changes A list of changes that have been made to a particular ban list.
     * @param ignoreSelf Whether to exclude changes that have been made by Mjolnir.
     * @returns true if the message was sent, false if it wasn't (because there there were no changes to report).
     */
    private async printBanlistChanges(changes: ListRuleChange[], list: PolicyList, ignoreSelf = false): Promise<boolean> {
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
            errors = errors.filter(e => this.errorCache.triggerError(e.roomId, e.errorKind));
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

    public requiredProtectionPermissions() {
        throw new TypeError("Unimplemented, need to put protections into here too.")
    }

    public async verifyPermissions(verbose = true, printRegardless = false) {
        const errors: RoomUpdateError[] = [];
        for (const roomId of this.protectedRooms) {
            errors.push(...(await this.protections.verifyPermissionsIn(roomId)));
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
}
