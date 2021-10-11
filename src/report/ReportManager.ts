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

import { MatrixClient } from "matrix-bot-sdk";
import { PowerLevelAction } from "matrix-bot-sdk/lib/models/PowerLevelAction";
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
const REPORT_KEY = "org.matrix.mjolnir.abuse.report";

/// Custom field embedded as part of confirmation reactions to embed abuse
/// reports (see `IConfirmationReport` for the content).
const CONFIRMATION_KEY = "org.matrix.mjolnir.abuse.report.confirmation";

/**
 * A class designed to respond to abuse reports.
 */
export class ReportManager {
    constructor(private mjolnir: Mjolnir) {
        // Configure bot interactions.
        mjolnir.client.on("room.event", async (roomId, event) => {
            console.debug("room.event", roomId, event);
            switch (event["type"]) {
                case "m.reaction": {
                    await this.handleReaction({ roomId, event });
                    break;
                }
            }
        });
    }

    /**
     * Display an incoming report received, e.g. from the /report Matrix API.
     *
     * @param roomId The room in which the abuse took place.
     * @param eventId The ID of the event reported as abuse.
     * @param reporterId The user who reported the event.
     * @param event The event being reported.
     * @param reason A reason provided by the reporter.
     */
    public async handleIncomingReport({ roomId, eventId, reporterId, event, reason }: { roomId: string, eventId: string, reporterId: string, event: any, reason?: string }) {
        let accusedId: string = event["sender"];
        console.debug("Accused", accusedId);

        /*
        Past this point, the following invariants hold:

        - The reporter is a member of `roomId`.
        - Event `eventId` did take place in room `roomId`.
        - The reporter could witness event `eventId` in room `roomId`.
        - Event `eventId` was reported by user `accusedId`.
        */

        let { displayname: reporterDisplayName }: { displayname: string } = await this.mjolnir.client.getUserProfile(reporterId);
        let { displayname: accusedDisplayName }: { displayname: string } = await this.mjolnir.client.getUserProfile(accusedId);
        let roomAliasOrId = roomId;
        try {
            roomAliasOrId = await this.mjolnir.client.getPublishedAlias(roomId) || roomId;
        } catch (ex) {
            // Ignore.
        }
        console.debug("Room is", roomAliasOrId, roomId);
        let eventShortcut = `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`;
        let roomShortcut = `https://matrix.to/#/${encodeURIComponent(roomAliasOrId)}`;
        let eventContent;
        if (event["type"] === "m.room.encrypted") {
            eventContent = "<encrypted content>";
        } else {
            eventContent = JSON.stringify(event["content"], null, 2);
        }

        // We now have all the information we need to produce an abuse report.

        // We need to send the report as html to be able to use spoiler markings.
        // We build this as dom to be absolutely certain that we're not introducing
        // any kind of injection within the report.
        const document = new JSDOM(
            "<body>" +
            "User <code id='reporter-display-name'></code> (<code id='reporter-id'></code>) " +
            "reported <a id='event-shortcut'>event <span id='event-id'></span></a> " +
            "sent by user <b><span id='accused-display-name'></span> (<span id='accused-id'></span>)</b> " +
            "in <a id='room-shortcut'>room <span id='room-alias-or-id'></span></a>." +
            "<div>Event content <span id='event-container'><code id='event-content'></code><span></div>" +
            "<div>Reporter commented: <code id='reason-content'></code></div>" +
            "</body>")
            .window
            .document;
        // ...insert text content
        for (let [key, value] of [
            ['reporter-display-name', reporterDisplayName],
            ['reporter-id', reporterId],
            ['accused-display-name', accusedDisplayName],
            ['accused-id', accusedId],
            ['event-id', eventId],
            ['room-alias-or-id', roomAliasOrId],
            ['event-content', eventContent],
            ['reason-content', reason || "<no reason given>"]
        ]) {
            document.getElementById(key)!.textContent = value;
        }
        // ...insert attributes
        for (let [key, value] of [
            ['event-shortcut', eventShortcut],
            ['room-shortcut', roomShortcut],
        ]) {
            (document.getElementById(key)! as HTMLAnchorElement).href = value;
        }
        // ...set presentation
        if (event["type"] !== "m.room.encrypted") {
            // If there's some event content, mark it as a spoiler.
            document.getElementById('event-container')!.
                setAttribute("data-mx-spoiler", "");
        }

        let report: IReport = {
            accusedId,
            reporterId,
            eventId,
            roomId,
            roomAliasOrId
        };
        let notice = {
            msgtype: "m.notice",
            body: htmlToText(document.body.outerHTML, { wordwrap: false }),
            format: "org.matrix.custom.html",
            formatted_body: document.body.outerHTML,
        };
        notice[REPORT_KEY] = report;
        console.debug("Sending notice", notice);

        let noticeEventId = await this.mjolnir.client.sendMessage(config.managementRoom, notice);
        for (let [label, action] of ACTIONS) {
            if (!await action.canExecute(this.mjolnir.client, report)) {
                continue;
            }
            await this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                "m.relates_to": {
                    "rel_type": "m.annotation",
                    "event_id": noticeEventId,
                    "key": `${action.emoji} ${action.title(report)} [${label}]`
                }
            });
        }

        console.debug("Formatted abuse report sent");
    }

    /**
     * Handle a reaction to an abuse report.
     *
     * @param roomId The room in which the reaction took place.
     * @param event The reaction.
     */
    public async handleReaction({ roomId, event }: { roomId: string, event: any }) {
        console.debug("handleReaction", roomId, event);
        if (roomId !== config.managementRoom) {
            // Let's not accept commands in rooms other than the management room.
            console.debug("handleReaction", "wrong room");
            return;
        }
        if (event.sender === await this.mjolnir.client.getUserId()) {
            // Let's not react to our own reactions.
            console.debug("handleReaction", "our own reaction");
            return;
        }
        let relation;
        try {
            relation = event["content"]["m.relates_to"]!;
        } catch (ex) {
            console.debug("Not a reaction", ex);
            return;
        }
        console.debug("relation", relation);

        // Get the original event.
        let initialReport: IReport | undefined, confirmationReport: IConfirmationReport | undefined;
        try {
            let originalEvent = await this.mjolnir.client.getEvent(roomId, relation.event_id);
            console.debug("originalEvent", originalEvent);
            if (!("content" in originalEvent)) {
                return;
            }
            let content = originalEvent["content"];
            if (REPORT_KEY in content) {
                initialReport = content[REPORT_KEY]!;
                console.debug("Initial report", initialReport);
            } else if (CONFIRMATION_KEY in content) {
                confirmationReport = content[CONFIRMATION_KEY]!;
                console.debug("Confirmation report", confirmationReport);
            }
        } catch (ex) {
            console.debug("Not a reaction to one of our reports", ex);
            return;
        }
        if (!initialReport && !confirmationReport) {
            console.debug!("Not a reaction to one of our reports")
            return;
        }

        /*
        At this point, we know that:

        - We're in the management room;
        - Either
          - `initialReport != undefined` and we're reacting to one of our reports; or
          - `confirmationReport != undefined` and we're reacting to a confirmation request.
        */

        console.debug("handleReport ready to act", confirmationReport || initialReport);
        if (confirmationReport) {
            console.debug("This is a confirmation report");
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
                    console.debug("Unknown decision", matches[2]);
                    return;
            }
            if (decision) {
                await this.executeAction({
                    label: matches[1],
                    report: confirmationReport,
                    successEventId: confirmationReport.notificationEventId,
                    failureEventId: relation.event_id,
                    onSuccessRemoveEventId: relation.event_id
                })
            } else {
                this.mjolnir.client.redactEvent(config.managementRoom, relation.event_id, "Action canceled");
            }

            return;
        } else if (initialReport) {
            console.debug("This is an initial report", relation.key);
            let matches = relation.key.match(REACTION_ACTION);
            let label: string = matches[1]!;
            console.debug("relation", relation, relation.event_id, label);
            let action: IUIAction | undefined = ACTIONS.get(label);
            if (!action) {
                console.debug("Not one of our actions");
                return;
            }
            let newConfirmationReport: any = {};
            for (let k of Object.keys(initialReport)) {
                newConfirmationReport[k] = initialReport[k];
            }
            newConfirmationReport.action = label;
            newConfirmationReport.notificationEventId = relation.event_id;
            confirmationReport = newConfirmationReport as IConfirmationReport;
            if (action.needsConfirmation) {
                // Send a confirmation request.
                console.debug("Action needs confirmation, labeling", initialReport, confirmationReport);
                let confirmation = {
                    msgtype: "m.notice",
                    body: `${action.emoji} ${action.title(initialReport)}?`,
                };
                confirmation[CONFIRMATION_KEY] = confirmationReport;

                let requestConfirmationEventId = await this.mjolnir.client.sendMessage(config.managementRoom, confirmation);
                await this.mjolnir.client.sendEvent(config.managementRoom, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": requestConfirmationEventId,
                        "key": `🆗 ${action.emoji} ${action.title(initialReport)} [${action.label}][${CONFIRM}]`
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
                console.debug("Action does not need confirmation");
                // Execute immediately.
                this.executeAction({
                    label,
                    report: confirmationReport,
                    successEventId: relation.event_id,
                    failureEventId: relation.eventId,
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
    async executeAction({ label, report, successEventId, failureEventId, onSuccessRemoveEventId }: { label: string, report: IConfirmationReport, successEventId: string, failureEventId: string, onSuccessRemoveEventId?: string }) {
        let action: IUIAction | undefined = ACTIONS.get(label);
        if (!action) {
            console.debug("Not one of our actions", label);
            return;
        }
        let error: any = null;
        try {
            console.debug("executeAction", action.label, report);
            await action.execute(this.mjolnir, report);
        } catch (ex) {
            console.debug("Error executing action", label, ex);
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
        }
    }
}

/**
 * An abuse report received from a user.
 */
interface IReport {
    /**
     * The user who sent the abuse report.
     */
    readonly accusedId: string,

    /**
     * The user who sent the message reported as abuse.
     */
    readonly reporterId: string,

    /**
     * The room in which `eventId` took place.
     */
    readonly roomId: string,
    readonly roomAliasOrId: string,

    /**
     * The event reported as abuse.
     */
    readonly eventId: string,
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
    readonly notificationEventId: string,
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
     * @param client A Matrix Client used to check powerlevels.
     * @param report Details on the abuse report.
     */
    canExecute(client: MatrixClient, report: IReport): Promise<boolean>;

    /**
     * A human-readable title to display for the end-user.
     *
     * @param report Details on the abuse report.
     */
    title(report: IReport): string;

    /**
     * Attempt to execute the action.
     */
    execute(mjolnir: Mjolnir, report: IConfirmationReport): Promise<void>;
}

/**
 * UI action: Ignore bad report
 */
class IgnoreBadReport implements IUIAction {
    public label = "bad-report";
    public emoji = "🚯";
    public needsConfirmation = true;
    public async canExecute(_client: MatrixClient, _report: IReport): Promise<boolean> {
        return true;
    }
    public title(_report: IReport): string {
        return "Ignore bad report";
    }
    public async execute(mjolnir: Mjolnir, report: IConfirmationReport): Promise<void> {
        await mjolnir.client.redactEvent(config.managementRoom, report.notificationEventId, "Report marked as invalid");
    }
}

/**
 * UI action: Redact reported message.
 */
class RedactMessage implements IUIAction {
    public label = "redact-message";
    public emoji = "🗍";
    public needsConfirmation = true;
    public async canExecute(client: MatrixClient, report: IReport): Promise<boolean> {
        try {
            return await client.userHasPowerLevelForAction(await client.getUserId(), report.roomId, PowerLevelAction.RedactEvents);
        } catch (ex) {
            return false;
        }
    }
    public title(report: IReport): string {
        return `Redact event ${report.eventId}`;
    }
    public async execute(mjolnir: Mjolnir, report: IConfirmationReport): Promise<void> {
        /*
        Ideally, we'd use the following:
        However, for some reason, this doesn't seem to work.

            mjolnir.queueRedactUserMessagesIn(report.accusedId, report.roomId);
            await mjolnir.syncListForRoom(report.roomId);
        */
        await mjolnir.client.redactEvent(report.roomId, report.eventId);
    }
}

/**
 * UI action: Kick accused user.
 */
class KickAccused implements IUIAction {
    public label = "kick-accused";
    public emoji = "⚽";
    public needsConfirmation = true;
    public async canExecute(client: MatrixClient, report: IReport): Promise<boolean> {
        try {
            return await client.userHasPowerLevelForAction(await client.getUserId(), report.roomId, PowerLevelAction.Kick);
        } catch (ex) {
            return false;
        }
    }
    public title(report: IReport): string {
        return `Kick ${report.accusedId} from room ${report.roomAliasOrId}`;
    }
    public async execute(mjolnir: Mjolnir, report: IConfirmationReport): Promise<void> {
        await mjolnir.client.kickUser(report.accusedId, report.roomId)
    }
}

/**
 * UI action: Mute accused user.
 */
class MuteAccused implements IUIAction {
    public label = "mute-accused";
    public emoji = "🤐";
    public needsConfirmation = true;
    public async canExecute(client: MatrixClient, report: IReport): Promise<boolean> {
        try {
            return await client.userHasPowerLevelFor(await client.getUserId(), report.roomId, "m.room.power_levels", true);
        } catch (ex) {
            return false;
        }
    }
    public title(report: IReport): string {
        return `Mute ${report.accusedId} in room ${report.roomAliasOrId}`;
    }
    public async execute(mjolnir: Mjolnir, report: IConfirmationReport): Promise<void> {
        await mjolnir.client.setUserPowerLevel(report.accusedId, report.roomId, -1);
    }
}

/**
 * UI action: Ban accused.
 */
class BanAccused implements IUIAction {
    public label = "ban-accused";
    public emoji = "🚫";
    public needsConfirmation = true;
    public async canExecute(client: MatrixClient, report: IReport): Promise<boolean> {
        try {
            return await client.userHasPowerLevelForAction(await client.getUserId(), report.roomId, PowerLevelAction.Ban);
        } catch (ex) {
            return false;
        }
    }
    public title(report: IReport): string {
        return `Ban ${report.accusedId} from room ${report.roomAliasOrId}`;
    }
    public async execute(mjolnir: Mjolnir, report: IConfirmationReport): Promise<void> {
        await mjolnir.client.banUser(report.accusedId, report.roomId);
    }
}

/**
 * A map of labels => actions.
 */
const ACTIONS = new Map([new KickAccused(), new RedactMessage(), new MuteAccused(), new BanAccused(), new IgnoreBadReport()].map(action => [action.label, action]));
