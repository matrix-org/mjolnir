/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

import { PowerLevelAction } from "matrix-bot-sdk/lib/models/PowerLevelAction";
import { LogService, UserID } from "matrix-bot-sdk";
import { htmlToText } from "html-to-text";
import { JSDOM } from 'jsdom';

import config from "../config";
import { Mjolnir } from "../Mjolnir";

/// Regexp, used to extract the action label from an action reaction
/// such as `⚽ Kick user @foobar:localhost from room [kick-user]`.
const REACTION_ACTION = /\[([a-z-]*)\]$/;

/// Regexp, used to extract the action label from a confirmation reaction
/// such as `🆗 ⚽ Kick user @foobar:localhost from room? [kick-user][confirm]`.
const REACTION_CONFIRMATION = /\[([a-z-]*)\]\[([a-z-]*)\]$/;

/// The hardcoded `confirm` string, as embedded in confirmation reactions.
const CONFIRM = "confirm";
/// The hardcoded `cancel` string, as embedded in confirmation reactions.
const CANCEL = "cancel";

/// Custom field embedded as part of notifications to embed abuse reports
/// (see `IReport` for the content).
export const ABUSE_REPORT_KEY = "org.matrix.mjolnir.abuse.report";

/// Custom field embedded as part of confirmation reactions to embed abuse
/// reports (see `IConfirmationReport` for the content).
export const ABUSE_ACTION_CONFIRMATION_KEY = "org.matrix.mjolnir.abuse.action.confirmation";

enum Kind {
    //! A MSC3215-style moderation request
    MODERATION_REQUEST,
    //! An abuse report, as per https://matrix.org/docs/spec/client_server/r0.6.1#post-matrix-client-r0-rooms-roomid-report-eventid
    SERVER_ABUSE_REPORT,
    //! Mjölnir encountered a problem while attempting to handle a moderation request or abuse report
    ERROR,
    //! A moderation request or server abuse report escalated by the server/room moderators.
    ESCALATED_REPORT,
}

/**
 * A class designed to respond to abuse reports.
 */
export class ReportManager {
    constructor(public mjolnir: Mjolnir) {
        // Configure bot interactions.
        mjolnir.client.on("room.event", async (roomId, event) => {
            switch (event["type"]) {
                case "m.reaction": {
                    await this.handleReaction({ roomId, event });
                    break;
                }
            }
        });
    }

    /**
     * Display an incoming abuse report received, e.g. from the /report Matrix API.
     * 
     * # Pre-requisites
     * 
     * The following MUST hold true:
     * - the reporter's id is `reporterId`;
     * - the reporter is a member of `roomId`;
     * - `eventId` did take place in room `roomId`;
     * - the reporter could witness event `eventId` in room `roomId`;
     * - the event being reported is `event`;
     *
     * @param roomId The room in which the abuse took place.
     * @param eventId The ID of the event reported as abuse.
     * @param reporterId The user who reported the event.
     * @param event The event being reported.
     * @param reason A reason provided by the reporter.
     */
    public async handleServerAbuseReport({ reporterId, event, reason }: { roomId: string, eventId: string, reporterId: string, event: any, reason?: string }) {
        return this.displayReportAndUI({ kind: Kind.SERVER_ABUSE_REPORT, event, reporterId, reason, moderationRoomId: config.managementRoom });
    }

    /**
     * Handle a reaction to an abuse report.
     *
     * @param roomId The room in which the reaction took place.
     * @param event The reaction.
     */
    public async handleReaction({ roomId, event }: { roomId: string, event: any }) {
        if (event.sender === await this.mjolnir.client.getUserId()) {
            // Let's not react to our own reactions.
            return;
        }

        if (roomId !== config.managementRoom) {
            // Let's not accept commands in rooms other than the management room.
            return;
        }
        let relation;
        try {
            relation = event["content"]["m.relates_to"]!;
        } catch (ex) {
            return;
        }

        // Get the original event.
        let initialReport: IReport | undefined, confirmationReport: IConfirmationReport | undefined;
        try {
            let originalEvent = await this.mjolnir.client.getEvent(roomId, relation.event_id);
            if (!("content" in originalEvent)) {
                return;
            }
            let content = originalEvent["content"];
            if (ABUSE_REPORT_KEY in content) {
                initialReport = content[ABUSE_REPORT_KEY]!;
            } else if (ABUSE_ACTION_CONFIRMATION_KEY in content) {
                confirmationReport = content[ABUSE_ACTION_CONFIRMATION_KEY]!;
            }
        } catch (ex) {
            return;
        }
        if (!initialReport && !confirmationReport) {
            return;
        }

        /*
        At this point, we know that:

        - We're in the management room;
        - Either
          - `initialReport != undefined` and we're reacting to one of our reports; or
          - `confirmationReport != undefined` and we're reacting to a confirmation request.
        */

        if (confirmationReport) {
            // Extract the action and the decision.
            let matches = relation.key.match(REACTION_CONFIRMATION);

            // Is it a yes or a no?
            let decision;
            switch (matches[2]) {
                case CONFIRM:
                    decision = true;
                    break;
                case CANCEL:
                    decision = false;
                    break;
                default:
                    LogService.debug("ReportManager::handleReaction", "Unknown decision", matches[2]);
                    return;
            }
            if (decision) {
                LogService.info("ReportManager::handleReaction", "User", event["sender"], "confirmed action", matches[1]);
                await this.executeAction({
                    label: matches[1],
                    report: confirmationReport,
                    successEventId: confirmationReport.notification_event_id,
                    failureEventId: relation.event_id,
                    onSuccessRemoveEventId: relation.event_id,
                    moderationRoomId: roomId
                })
            } else {
                LogService.info("ReportManager::handleReaction", "User", event["sender"], "canceled action", matches[1]);
                this.mjolnir.client.redactEvent(config.managementRoom, relation.event_id, "Action canceled");
            }

            return;
        } else if (initialReport) {
            let matches = relation.key.match(REACTION_ACTION);
            let label: string = matches[1]!;
            let action: IUIAction | undefined = ACTIONS.get(label);
            if (!action) {
                return;
            }
            let confirmationReport: IConfirmationReport = {
                action: label,
                notification_event_id: relation.event_id,
                ...initialReport
            };
            LogService.info("ReportManager::handleReaction", "User", event["sender"], "picked action", label, initialReport);
            if (action.needsConfirmation) {
                // Send a confirmation request.
                let confirmation = {
                    msgtype: "m.notice",
                    body: `${action.emoji} ${await action.title(this, initialReport)}?`,
                    "m.relationship": {
                        "rel_type": "m.reference",
                        "event_id": relation.event_id,
                    }
                };
                confirmation[ABUSE_ACTION_CONFIRMATION_KEY] = confirmationReport;

                let requestConfirmationEventId = await this.mjolnir.client.sendMessage(config.managementRoom, confirmation);
                await this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": requestConfirmationEventId,
                        "key": `🆗 ${action.emoji} ${await action.title(this, initialReport)} [${action.label}][${CONFIRM}]`
                    }
                });
                await this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": requestConfirmationEventId,
                        "key": `⬛ Cancel [${action.label}][${CANCEL}]`
                    }
                });
            } else {
                // Execute immediately.
                LogService.info("ReportManager::handleReaction", "User", event["sender"], "executed (no confirmation needed) action", matches[1]);
                this.executeAction({
                    label,
                    report: confirmationReport,
                    successEventId: relation.event_id,
                    failureEventId: relation.eventId,
                    moderationRoomId: roomId
                })
            }
        }
    }


    /**
      * Execute a report-specific action.
      *
      * This is executed when the user clicks on an action to execute (if the action
      * does not need confirmation) or when the user clicks on "confirm" in a confirmation
      * (otherwise).
      *
      * @param label The type of action to execute, e.g. `kick-user`.
      * @param report The abuse report on which to take action.
      * @param successEventId The event to annotate with a "OK" in case of success.
      * @param failureEventId The event to annotate with a "FAIL" in case of failure.
      * @param onSuccessRemoveEventId Optionally, an event to remove in case of success (e.g. the confirmation dialog).
      */
    async executeAction({ label, report, successEventId, failureEventId, onSuccessRemoveEventId, moderationRoomId }: { label: string, report: IConfirmationReport, successEventId: string, failureEventId: string, onSuccessRemoveEventId?: string, moderationRoomId: string }) {
        let action: IUIAction | undefined = ACTIONS.get(label);
        if (!action) {
            return;
        }
        let error: any = null;
        let response;
        try {
            // Check security.
            if (moderationRoomId == config.managementRoom) {
                // Always accept actions executed from the management room.
            } else {
                throw new Error("Security error: Cannot execute this action.");
            }
            response = await action.execute(this, report, moderationRoomId);
        } catch (ex) {
            error = ex;
        }
        if (error) {
            this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                "m.relates_to": {
                    "rel_type": "m.annotation",
                    "event_id": failureEventId,
                    "key": `${action.emoji} ❌`
                }
            });
            this.mjolnir.client.sendEvent(config.managementRoom, "m.notice", {
                "body": error.message || "<unknown error>",
                "m.relationship": {
                    "rel_type": "m.reference",
                    "event_id": failureEventId,
                }
            })
        } else {
            this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                "m.relates_to": {
                    "rel_type": "m.annotation",
                    "event_id": successEventId,
                    "key": `${action.emoji} ✅`
                }
            });
            if (onSuccessRemoveEventId) {
                this.mjolnir.client.redactEvent(config.managementRoom, onSuccessRemoveEventId, "Action complete");
            }
            if (response) {
                this.mjolnir.client.sendMessage(config.managementRoom, {
                    msgtype: "m.notice",
                    "formatted_body": response,
                    format: "org.matrix.custom.html",
                    "body": htmlToText(response),
                    "m.relationship": {
                        "rel_type": "m.reference",
                        "event_id": successEventId
                    }
                })
            }
        }
    }

    /**
     * Display the report and any UI button.
     *
     * 
     * # Security
     * 
     * This method DOES NOT PERFORM ANY SECURITY CHECKS.
     * 
     * @param kind The kind of report (server-wide abuse report / room moderation request). Low security.
     * @param event The offending event. The fact that it's the offending event MUST be checked. No assumptions are made on the content.
     * @param reporterId The user who reported the event. MUST be checked.
     * @param reason A user-provided comment. Low-security.
     * @param moderationRoomId The room in which the report and ui will be displayed. MUST be checked.
     */
    async displayReportAndUI(args: { kind: Kind, event: any, reporterId: string, reason?: string, nature?: string, moderationRoomId: string, error?: string }) {
        let { kind, event, reporterId, reason, nature, moderationRoomId, error } = args;

        let roomId = event["room_id"]!;
        let eventId = event["event_id"]!;

        let roomAliasOrId = roomId;
        try {
            roomAliasOrId = await this.mjolnir.client.getPublishedAlias(roomId) || roomId;
        } catch (ex) {
            // Ignore.
        }

        let eventContent;
        try {
            if (event["type"] === "m.room.encrypted") {
                eventContent = { msg: "<encrypted content>" };
            } else if ("content" in event) {
                if ("formatted_body" in event.content) {
                    eventContent = { html: event.content.formatted_body };
                } else if ("body" in event.content) {
                    eventContent = { text: event.content.body };
                } else {
                    eventContent = { text: JSON.stringify(event["content"], null, 2) };
                }
            }
        } catch (ex) {
            eventContent = { msg: `<Cannot extract event. Please verify that Mjölnir has been invited to room ${roomAliasOrId} and made room moderator or administrator>.` };
        }

        let accusedId = event["sender"];

        let reporterDisplayName: string, accusedDisplayName: string;
        try {
            reporterDisplayName = await this.mjolnir.client.getUserProfile(reporterId)["displayname"] || reporterId;
        } catch (ex) {
            reporterDisplayName = "<Error: Cannot extract reporter display name>";
        }
        try {
            accusedDisplayName = await this.mjolnir.client.getUserProfile(accusedId)["displayname"] || accusedId;
        } catch (ex) {
            accusedDisplayName = "<Error: Cannot extract accused display name>";
        }

        let eventShortcut = `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`;
        let roomShortcut = `https://matrix.to/#/${encodeURIComponent(roomAliasOrId)}`;

        let eventTimestamp;
        try {
            eventTimestamp = new Date(event["origin_server_ts"]).toUTCString();
        } catch (ex) {
            eventTimestamp = `<Cannot extract event. Please verify that Mjölnir has been invited to room ${roomAliasOrId} and made room moderator or administrator>.`;
        }

        let title;
        switch (kind) {
            case Kind.MODERATION_REQUEST:
                title = "Moderation request";
                break;
            case Kind.SERVER_ABUSE_REPORT:
                title = "Abuse report";
                break;
            case Kind.ESCALATED_REPORT:
                title = "Moderation request escalated by moderators";
                break;
            case Kind.ERROR:
                title = "Error";
                break;
        }

        let readableNature;
        switch (nature) {
            case "org.matrix.msc3215.abuse.nature.disagreement":
                readableNature = "disagreement";
                break;
            case "org.matrix.msc3215.abuse.nature.harassment":
                readableNature = "harassment/bullying";
                break;
            case "org.matrix.msc3215.abuse.nature.csam":
                readableNature = "child sexual abuse material [illegal, consider warning authorities]";
                break;
            case "org.matrix.msc3215.abuse.nature.hate_speech":
                readableNature = "spam";
                break;
            case "org.matrix.msc3215.abuse.nature.spam":
                readableNature = "impersonation";
                break;
            case "org.matrix.msc3215.abuse.nature.impersonation":
                readableNature = "impersonation";
                break;
            case "org.matrix.msc3215.abuse.nature.doxxing":
                readableNature = "non-consensual sharing of identifiable private information of a third party (doxxing)";
                break;
            case "org.matrix.msc3215.abuse.nature.violence":
                readableNature = "threats of violence or death, either to self or others";
                break;
            case "org.matrix.msc3215.abuse.nature.terrorism":
                readableNature = "terrorism [illegal, consider warning authorities]";
                break;
            case "org.matrix.msc3215.abuse.nature.unwanted_sexual_advances":
                readableNature = "unwanted sexual advances, sextortion, ... [possibly illegal, consider warning authorities]"
                break;
            case "org.matrix.msc3215.abuse.nature.ncii":
                readableNature = "non consensual intimate imagery, including revenge porn"
                break;
            case "org.matrix.msc3215.abuse.nature.nsfw":
                readableNature = "NSFW content (pornography, gore...) in a SFW room";
                break;
            case "org.matrix.msc3215.abuse.nature.disinformation":
                readableNature = "disinformation"
                break;
            case null:
            case undefined:
            case "org.matrix.msc3215.abuse.nature.other":
            default:
                readableNature = "unspecified";
                break;
        }

        // We need to send the report as html to be able to use spoiler markings.
        // We build this as dom to be absolutely certain that we're not introducing
        // any kind of injection within the report.

        // Please do NOT insert any `${}` in the following backticks, to avoid
        // any XSS attack.
        const document = new JSDOM(`
        <body>
        <div>
            <b><span id="title"></span></b>
        </div>
        <div>
            <b>Filed by</b> <span id='reporter-display-name'></span> (<code id='reporter-id'></code>)
        </div>
        <b>Against</b> <span id='accused-display-name'></span> (<code id='accused-id'></code>)
        <div>
            <b>Nature</b> <span id='nature-display'></span> (<code id='nature-source'></code>)
        </div>
        <div>
            <b>Room</b> <a id='room-shortcut'><span id='room-alias-or-id'></span></a>
        </div>
        <hr />
        <div id='details-or-error'>
        <details>
            <summary>Event details</summary>
            <div>
            <b>Event</b> <span id='event-id'></span> <a id='event-shortcut'>Go to event</a>
            </div>
            <div>
            <b>When</b> <span id='event-timestamp'></span>
            </div>
            <div>
            <b>Content</b> <span id='event-container'><code id='event-content'></code><span>
            </div>
        </details>
        </div>
        <hr />
        <b>Comments</b> <code id='reason-content'></code></div>
        </body>`).window.document;

        // ...insert text content
        for (let [key, value] of [
            ['title', title],
            ['reporter-display-name', reporterDisplayName],
            ['reporter-id', reporterId],
            ['accused-display-name', accusedDisplayName],
            ['accused-id', accusedId],
            ['event-id', eventId],
            ['room-alias-or-id', roomAliasOrId],
            ['reason-content', reason || "<no reason given>"],
            ['nature-display', readableNature],
            ['nature-source', nature || "<no nature provided>"],
            ['event-timestamp', eventTimestamp],
            ['details-or-error', kind == Kind.ERROR ? error : null]
        ]) {
            let node = document.getElementById(key);
            if (node && value) {
                node.textContent = value;
            }
        }
        // ...insert links
        for (let [key, value] of [
            ['event-shortcut', eventShortcut],
            ['room-shortcut', roomShortcut],
        ]) {
            let node = document.getElementById(key) as HTMLAnchorElement;
            if (node) {
                node.href = value;
            }
        }

        // ...insert HTML content
        for (let [key, value] of [
            ['event-content', eventContent],
        ]) {
            let node = document.getElementById(key);
            if (node) {
                if ("msg" in value) {
                    node.textContent = value.msg;
                } else if ("text" in value) {
                    node.textContent = value.text;
                } else if ("html" in value) {
                    node.innerHTML = value.html;
                }
            }
        }

        // ...set presentation
        if (!("msg" in eventContent)) {
            // If there's some event content, mark it as a spoiler.
            document.getElementById('event-container')!.
                setAttribute("data-mx-spoiler", "");
        }

        // Embed additional information in the notice, for use by the
        // action buttons.
        let report: IReport = {
            accused_id: accusedId,
            reporter_id: reporterId,
            event_id: eventId,
            room_id: roomId,
            room_alias_or_id: roomAliasOrId,
        };
        let notice = {
            msgtype: "m.notice",
            body: htmlToText(document.body.outerHTML, { wordwrap: false }),
            format: "org.matrix.custom.html",
            formatted_body: document.body.outerHTML,
        };
        notice[ABUSE_REPORT_KEY] = report;

        let noticeEventId = await this.mjolnir.client.sendMessage(config.managementRoom, notice);
        if (kind != Kind.ERROR) {
            // Now let's display buttons.
            for (let [label, action] of ACTIONS) {
                // Display buttons for actions that can be executed.
                if (!await action.canExecute(this, report, moderationRoomId)) {
                    continue;
                }
                await this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": noticeEventId,
                        "key": `${action.emoji} ${await action.title(this, report)} [${label}]`
                    }
                });
            }
        }
    }
}

/**
 * An abuse report received from a user.
 *
 * Note: These reports end up embedded in Matrix messages, so we're using Matrix
 * naming conventions rather than JS/TS naming conventions.
 */
interface IReport {
    /**
     * The user who sent the abuse report.
     */
    readonly accused_id: string,

    /**
     * The user who sent the message reported as abuse.
     */
    readonly reporter_id: string,

    /**
     * The room in which `eventId` took place.
     */
    readonly room_id: string,
    readonly room_alias_or_id: string,

    /**
     * The event reported as abuse.
     */
    readonly event_id: string,
}

/**
 * An abuse report, extended with the information we need for a confirmation report.
 */
interface IConfirmationReport extends IReport {
    /**
     * The label of the action we're confirming, e.g. `kick-user`.
     */
    readonly action: string,

    /**
     * The event in which we originally notified of the abuse.
     */
    readonly notification_event_id: string,
}

/**
 * A user action displayed in the UI as a Matrix reaction.
 */
interface IUIAction {
    /**
     * A unique label.
     *
     * Used by Mjölnir to differentiate the actions, e.g. `kick-user`.
     */
    readonly label: string;

    /**
     * A unique Emoji.
     *
     * Used to help users avoid making errors when clicking on a button.
     */
    readonly emoji: string;

    /**
     * If `true`, this is an action that needs confirmation. Otherwise, the
     * action may be executed immediately.
     */
    readonly needsConfirmation: boolean;

    /**
     * Detect whether the action may be executed, e.g. whether Mjölnir has
     * sufficient powerlevel to execute this action.
     * 
     * **Security caveat** This assumes that the security policy on whether
     * the operation can be executed is:
     * 
     * > *Anyone* in the moderation room and who isn't muted can execute
     * > an operation iff Mjölnir has the rights to execute it.
     *
     * @param report Details on the abuse report.
     */
    canExecute(manager: ReportManager, report: IReport, moderationRoomId: string): Promise<boolean>;

    /**
     * A human-readable title to display for the end-user.
     *
     * @param report Details on the abuse report.
     */
    title(manager: ReportManager, report: IReport): Promise<string>;

    /**
     * Attempt to execute the action.
     */
    execute(manager: ReportManager, report: IReport, moderationRoomId: string): Promise<string | undefined>;
}

/**
 * UI action: Ignore bad report
 */
class IgnoreBadReport implements IUIAction {
    public label = "bad-report";
    public emoji = "🚯";
    public needsConfirmation = true;
    public async canExecute(_manager: ReportManager, _report: IReport): Promise<boolean> {
        return true;
    }
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Ignore bad report";
    }
    public async execute(manager: ReportManager, report: IConfirmationReport): Promise<string | undefined> {
        await manager.mjolnir.client.redactEvent(config.managementRoom, report.notification_event_id, "Report marked as invalid");
        return;
    }
}

/**
 * UI action: Redact reported message.
 */
class RedactMessage implements IUIAction {
    public label = "redact-message";
    public emoji = "🗍";
    public needsConfirmation = true;
    public async canExecute(manager: ReportManager, report: IReport): Promise<boolean> {
        try {
            return await manager.mjolnir.client.userHasPowerLevelForAction(await manager.mjolnir.client.getUserId(), report.room_id, PowerLevelAction.RedactEvents);
        } catch (ex) {
            return false;
        }
    }
    public async title(_manager: ReportManager, report: IReport): Promise<string> {
        return `Redact event ${report.event_id}`;
    }
    public async execute(manager: ReportManager, report: IReport, _moderationRoomId: string): Promise<string | undefined> {
        /*
        Ideally, we'd use the following:
        However, for some reason, this doesn't seem to work.

            mjolnir.queueRedactUserMessagesIn(report.accused_id, report.room_id);
            await mjolnir.syncListForRoom(report.room_id);
        */
        await manager.mjolnir.client.redactEvent(report.room_id, report.event_id);
        return;
    }
}

/**
 * UI action: Kick accused user.
 */
class KickAccused implements IUIAction {
    public label = "kick-accused";
    public emoji = "⚽";
    public needsConfirmation = true;
    public async canExecute(manager: ReportManager, report: IReport): Promise<boolean> {
        try {
            return await manager.mjolnir.client.userHasPowerLevelForAction(await manager.mjolnir.client.getUserId(), report.room_id, PowerLevelAction.Kick);
        } catch (ex) {
            return false;
        }
    }
    public async title(_manager: ReportManager, report: IReport): Promise<string> {
        return `Kick ${report.accused_id} from room ${report.room_alias_or_id}`;
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        await manager.mjolnir.client.kickUser(report.accused_id, report.room_id);
        return;
    }
}

/**
 * UI action: Mute accused user.
 */
class MuteAccused implements IUIAction {
    public label = "mute-accused";
    public emoji = "🤐";
    public needsConfirmation = true;
    public async canExecute(manager: ReportManager, report: IReport): Promise<boolean> {
        try {
            return await manager.mjolnir.client.userHasPowerLevelFor(await manager.mjolnir.client.getUserId(), report.room_id, "m.room.power_levels", true);
        } catch (ex) {
            return false;
        }
    }
    public async title(_manager: ReportManager, report: IReport): Promise<string> {
        return `Mute ${report.accused_id} in room ${report.room_alias_or_id}`;
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        await manager.mjolnir.client.setUserPowerLevel(report.accused_id, report.room_id, -1);
        return;
    }
}

/**
 * UI action: Ban accused.
 */
class BanAccused implements IUIAction {
    public label = "ban-accused";
    public emoji = "🚫";
    public needsConfirmation = true;
    public async canExecute(manager: ReportManager, report: IReport): Promise<boolean> {
        try {
            return await manager.mjolnir.client.userHasPowerLevelForAction(await manager.mjolnir.client.getUserId(), report.room_id, PowerLevelAction.Ban);
        } catch (ex) {
            return false;
        }
    }
    public async title(_manager: ReportManager, report: IReport): Promise<string> {
        return `Ban ${report.accused_id} from room ${report.room_alias_or_id}`;
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        await manager.mjolnir.client.banUser(report.accused_id, report.room_id);
        return;
    }
}

/**
 * UI action: Help.
 */
class Help implements IUIAction {
    public label = "help";
    public emoji = "❓";
    public needsConfirmation = false;
    public async canExecute(_manager: ReportManager, _report: IReport): Promise<boolean> {
        return true;
    }
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Help";
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        // Produce a html list of actions, in the order specified by ACTION_LIST.
        let list = ACTION_LIST.map(action => `<li>${action.emoji} ${action.title(manager, report)}</li>`).join("\n");
        let body = `<ul>${list}</ul>`;
        return body;
    }
}

/**
 * Escalate to the moderation room of this instance of Mjölnir.
 */
class EscalateToServerModerationRoom implements IUIAction {
    public label = "escalate-to-server-moderation";
    public emoji = "⏫";
    public needsConfirmation = true;
    public async canExecute(manager: ReportManager, report: IReport, moderationRoomId: string): Promise<boolean> {
        if (moderationRoomId == config.managementRoom) {
            // We're already at the top of the chain.
            return false;
        }
        try {
            await manager.mjolnir.client.getEvent(report.room_id, report.event_id);
        } catch (ex) {
            // We can't fetch the event.
            return false;
        }
        return true;
    }
    public async title(manager: ReportManager, _report: IReport): Promise<string> {
        return `Escalate report to ${getHomeserver(await manager.mjolnir.client.getUserId())} server moderators`;
    }
    public async execute(manager: ReportManager, report: IReport, moderationRoomId: string): Promise<string | undefined> {
        let event = await manager.mjolnir.client.getEvent(report.room_id, report.event_id);

        // Display the report and UI directly in the management room, as if it had been
        // received from /report.
        //
        // Security:
        // - `kind`: statically known good;
        // - `moderationRoomId`: statically known good;
        // - `reporterId`: we trust `report`, could be forged by a moderator, low impact;
        // - `event`: checked just before.
        await manager.displayReportAndUI({ kind: Kind.ESCALATED_REPORT, reporterId: report.reporter_id, moderationRoomId: config.managementRoom, event });
        return;
    }
}

/**
 * The actions we may be able to undertake in reaction to a report.
 *
 * As a list, ordered for displayed when users click on "Help".
 */
const ACTION_LIST = [
    new KickAccused(),
    new RedactMessage(),
    new MuteAccused(),
    new BanAccused(),
    new EscalateToServerModerationRoom(),
    new IgnoreBadReport(),
    new Help()
];
/**
 * The actions we may be able to undertake in reaction to a report.
 *
 * As a map of labels => actions.
 */
const ACTIONS = new Map(ACTION_LIST.map(action => [action.label, action]));

function getHomeserver(userId: string): string {
    return new UserID(userId).domain
}
