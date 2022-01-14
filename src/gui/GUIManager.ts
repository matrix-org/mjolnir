import { htmlToText } from "html-to-text";
import * as htmlEscape from "escape-html";

import { JSDOM } from "jsdom";
import { LogService } from "matrix-bot-sdk";
import { Mjolnir } from "../Mjolnir";
import { limitLength } from "../utils";

/// Regexp, used to extract the action label from an action reaction
/// such as `⚽ Kick user @foobar:localhost from room [kick-user]`.
const REACTION_ACTION = /\[([a-z-]*)\]$/;

/// Regexp, used to extract the action label from a confirmation reaction
/// such as `🆗 ⚽ Kick user @foobar:localhost from room? [kick-user][confirm]`.
const REACTION_CONFIRMATION = /\[([a-z-]*)\]\[([a-z-]*)\]$/;

export const NATURE_DESCRIPTIONS_LIST: readonly [string, string][] = Object.freeze([
    ["org.matrix.msc3215.abuse.nature.disagreement", "disagreement"],
    ["org.matrix.msc3215.abuse.nature.harassment", "harassment/bullying"],
    ["org.matrix.msc3215.abuse.nature.csam", "child sexual abuse material [likely illegal, consider warning authorities]"],
    ["org.matrix.msc3215.abuse.nature.hate_speech", "spam"],
    ["org.matrix.msc3215.abuse.nature.spam", "impersonation"],
    ["org.matrix.msc3215.abuse.nature.impersonation", "impersonation"],
    ["org.matrix.msc3215.abuse.nature.doxxing", "non-consensual sharing of identifiable private information of a third party (doxxing)"],
    ["org.matrix.msc3215.abuse.nature.violence", "threats of violence or death, either to self or others"],
    ["org.matrix.msc3215.abuse.nature.terrorism", "terrorism [likely illegal, consider warning authorities]"],
    ["org.matrix.msc3215.abuse.nature.unwanted_sexual_advances", "unwanted sexual advances, sextortion, ... [possibly illegal, consider warning authorities]"],
    ["org.matrix.msc3215.abuse.nature.ncii", "non consensual intimate imagery, including revenge porn"],
    ["org.matrix.msc3215.abuse.nature.nsfw", "NSFW content (pornography, gore...) in a SFW room"],
    ["org.matrix.msc3215.abuse.nature.disinformation", "disinformation"],
]);
const NATURE_DESCRIPTIONS = new Map(NATURE_DESCRIPTIONS_LIST);


export enum Kind {
    //! A MSC3215-style moderation request
    MODERATION_REQUEST,
    //! An abuse report, as per https://matrix.org/docs/spec/client_server/r0.6.1#post-matrix-client-r0-rooms-roomid-report-eventid
    SERVER_ABUSE_REPORT,
    //! Mjölnir encountered a problem while attempting to handle a moderation request or abuse report
    ERROR,
    //! A moderation request or server abuse report escalated by the server/room moderators.
    ESCALATED_REPORT,
    //! A message in the trashcan.
    MESSAGE_IN_TRASHCAN,
}

/// The hardcoded `confirm` string, as embedded in confirmation reactions.
const CONFIRM = "confirm";
/// The hardcoded `cancel` string, as embedded in confirmation reactions.
const CANCEL = "cancel";

/**
 * An abuse report received from a user.
 *
 * Note: These reports end up embedded in Matrix messages,
 * so we're using Matrix naming conventions rather than JS/TS
 * naming conventions.
 */
export interface IReport {
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
 *
 * Note: These reports end up embedded in Matrix messages, behind key `ABUSE_ACTION_CONFIRMATION_KEY`,
 * so we're using Matrix naming conventions rather than JS/TS naming conventions.
*/
export interface IReportWithAction extends IReport {
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
export interface IUIAction<Manager extends { mjolnir: Mjolnir }> {
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
    canExecute(manager: Manager, report: IReport, interactionRoomId: string): Promise<boolean>;

    /**
     * A human-readable title to display for the end-user.
     *
     * @param report Details on the abuse report.
     */
    title(manager: Manager, report: IReport): Promise<string>;

    /**
     * A human-readable help message to display for the end-user.
     *
     * @param report Details on the abuse report.
     */
    help(manager: Manager, report: IReport): Promise<string>;

    /**
     * Attempt to execute the action.
     *
     * If this method resolves to a non-empty string, the string is
     * displayed in the interaction room as formatted body.
     */
    execute(manager: Manager, report: IReportWithAction, interactionRoomId: string, displayManager: GUIManager<Manager>): Promise<string | undefined>;
}

export type Actions<Owner extends { mjolnir: Mjolnir }> = [string /* label */, IUIAction<Owner>][];

export class GUIManager<Owner extends { mjolnir: Mjolnir }> {
    private readonly owner: Owner;
    private readonly interactionRoomId: string;
    private readonly actions: Map<string, IUIAction<Owner>>;
    private readonly reportKey: string;
    private readonly confirmKey: string;
    constructor({ owner, interactionRoomId, actions, reportKey, confirmKey }: { owner: Owner, interactionRoomId: string, actions: Actions<Owner>, reportKey: string, confirmKey?: string }) {
        this.owner = owner;
        this.interactionRoomId = interactionRoomId;
        this.actions = new Map(actions);
        this.reportKey = reportKey;
        this.confirmKey = confirmKey || `${reportKey}.confirm`;
        // Configure bot interactions.
        this.owner.mjolnir.client.on("room.event", async (roomId, event) => {
            try {
                switch (event["type"]) {
                    case "m.reaction": {
                        // FIXME: Really
                        await this.handleReaction({ roomId, event });
                        break;
                    }
                }
            } catch (ex) {
                LogService.error("ReportManager", "Uncaught error while handling an event", ex);
            }
        });

    }

    /**
     * Display the report and any UI button.
     *
     *
     * # Security
     *
     * This method DOES NOT PERFORM ANY SECURITY CHECKS.
     *
     * @param kind The kind of report (server-wide abuse report / room moderation request / ...). Low security.
     * @param event The offending event. The fact that it's the offending event MUST be checked. No assumptions are made on the content.
     * @param reporterId The user who reported the event. MUST be checked.
     * @param reason A user-provided comment. Low-security.
     * @param interactionRoomId The room in which the report and ui will be displayed. MUST be checked.
     */
    public async displayReportAndUI(args: { kind: Kind, event: any, reporterId: string, reason?: string, nature?: string, interactionRoomId: string, error?: string }) {
        let { kind, event, reporterId, reason, nature, interactionRoomId, error } = args;

        let roomId = event["room_id"]!;
        let eventId = event["event_id"]!;

        let roomAliasOrId = roomId;
        try {
            roomAliasOrId = await this.owner.mjolnir.client.getPublishedAlias(roomId) || roomId;
        } catch (ex) {
            // Ignore.
        }

        let eventContent;
        try {
            if (event["type"] === "m.room.encrypted") {
                eventContent = { msg: "<encrypted content>" };
            } else if ("content" in event) {
                const MAX_EVENT_CONTENT_LENGTH = 2048;
                const MAX_NEWLINES = 64;
                if ("formatted_body" in event.content) {
                    eventContent = { html: limitLength(event.content.formatted_body, MAX_EVENT_CONTENT_LENGTH, MAX_NEWLINES) };
                } else if ("body" in event.content) {
                    eventContent = { text: limitLength(event.content.body, MAX_EVENT_CONTENT_LENGTH, MAX_NEWLINES) };
                } else {
                    eventContent = { text: limitLength(JSON.stringify(event["content"], null, 2), MAX_EVENT_CONTENT_LENGTH, MAX_NEWLINES) };
                }
            }
        } catch (ex) {
            eventContent = { msg: `<Cannot extract event. Please verify that Mjölnir has been invited to room ${roomAliasOrId} and made room moderator or administrator>.` };
        }

        let accusedId = event["sender"];

        let reporterDisplayName: string, accusedDisplayName: string;
        try {
            reporterDisplayName = await this.owner.mjolnir.client.getUserProfile(reporterId)["displayname"] || reporterId;
        } catch (ex) {
            reporterDisplayName = "<Error: Cannot extract reporter display name>";
        }
        try {
            accusedDisplayName = await this.owner.mjolnir.client.getUserProfile(accusedId)["displayname"] || accusedId;
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
            case Kind.MESSAGE_IN_TRASHCAN:
                title = "Message pending moderation";
                break;
        }

        let readableNature = "unspecified";
        if (nature) {
            readableNature = NATURE_DESCRIPTIONS.get(nature) || readableNature;
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
        <details>
        <summary>Comments</summary>
        <b>Comments</b> <code id='reason-content'></code></div>
        </details>
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
            ['details-or-error', kind === Kind.ERROR ? error : null]
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
        notice[this.reportKey] = report;

        let noticeEventId = await this.owner.mjolnir.client.sendMessage(this.interactionRoomId, notice);
        if (kind !== Kind.ERROR) {
            // Now let's display buttons.
            for (let [label, action] of this.actions) {
                // Display buttons for actions that can be executed.
                if (!await action.canExecute(this.owner, report, interactionRoomId)) {
                    continue;
                }
                await this.owner.mjolnir.client.sendEvent(this.interactionRoomId, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": noticeEventId,
                        "key": `${action.emoji} ${await action.title(this.owner, report)} [${label}]`
                    }
                });
            }
        }
    }

    /**
      * Handle a reaction to a report.
      *
      * @param roomId The room in which the reaction took place.
      * @param event The reaction.
      */
    private async handleReaction({ roomId, event }: { roomId: string, event: any }) {
        if (event.sender === await this.owner.mjolnir.client.getUserId()) {
            // Let's not react to our own reactions.
            return;
        }

        if (roomId !== this.interactionRoomId) {
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
        let initialNoticeReport: IReport | undefined, confirmationReport: IReportWithAction | undefined;
        try {
            let originalEvent = await this.owner.mjolnir.client.getEvent(roomId, relation.event_id);
            if (!("content" in originalEvent)) {
                return;
            }
            let content = originalEvent["content"];
            if (this.reportKey in content) {
                initialNoticeReport = content[this.reportKey]!;
            } else if (this.confirmKey in content) {
                confirmationReport = content[this.confirmKey]!;
            }
        } catch (ex) {
            return;
        }
        if (!initialNoticeReport && !confirmationReport) {
            return;
        }

        /*
        At this point, we know that:

        - We're in the management room;
        - Either
          - `initialNoticeReport` is defined and we're reacting to one of our reports; or
          - `confirmationReport` is defined and we're reacting to a confirmation request.
        */

        if (confirmationReport) {
            // Extract the action and the decision.
            let matches = relation.key.match(REACTION_CONFIRMATION);
            if (!matches) {
                // Invalid key.
                return;
            }

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
                    LogService.debug("GUIManager::handleReaction", "Unknown decision", matches[2]);
                    return;
            }
            if (decision) {
                LogService.info("GUIManager::handleReaction", "User", event["sender"], "confirmed action", matches[1]);
                await this.executeAction({
                    label: matches[1],
                    report: confirmationReport,
                    successEventId: confirmationReport.notification_event_id,
                    failureEventId: relation.event_id,
                    onSuccessRemoveEventId: relation.event_id,
                    interactionRoomId: roomId
                })
            } else {
                LogService.info("GUIManager::handleReaction", "User", event["sender"], "cancelled action", matches[1]);
                this.owner.mjolnir.client.redactEvent(this.interactionRoomId, relation.event_id, "Action cancelled");
            }

            return;
        } else if (initialNoticeReport) {
            let matches = relation.key.match(REACTION_ACTION);
            if (!matches) {
                // Invalid key.
                return;
            }

            let label: string = matches[1]!;
            let action: IUIAction<Owner> | undefined = this.actions.get(label);
            if (!action) {
                return;
            }
            confirmationReport = {
                action: label,
                notification_event_id: relation.event_id,
                ...initialNoticeReport
            };
            LogService.info("GUIManager::handleReaction", "User", event["sender"], "picked action", label, initialNoticeReport);
            if (action.needsConfirmation) {
                // Send a confirmation request.
                let confirmation = {
                    msgtype: "m.notice",
                    body: `${action.emoji} ${await action.title(this.owner, initialNoticeReport)}?`,
                    "m.relationship": {
                        "rel_type": "m.reference",
                        "event_id": relation.event_id,
                    }
                };
                confirmation[this.confirmKey] = confirmationReport;

                let requestConfirmationEventId = await this.owner.mjolnir.client.sendMessage(this.interactionRoomId, confirmation);
                await this.owner.mjolnir.client.sendEvent(this.interactionRoomId, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": requestConfirmationEventId,
                        "key": `🆗 ${action.emoji} ${await action.title(this.owner, initialNoticeReport)} [${action.label}][${CONFIRM}]`
                    }
                });
                await this.owner.mjolnir.client.sendEvent(this.interactionRoomId, "m.reaction", {
                    "m.relates_to": {
                        "rel_type": "m.annotation",
                        "event_id": requestConfirmationEventId,
                        "key": `⬛ Cancel [${action.label}][${CANCEL}]`
                    }
                });
            } else {
                // Execute immediately.
                LogService.info("GUIManager::handleReaction", "User", event["sender"], "executed (no confirmation needed) action", matches[1]);
                this.executeAction({
                    label,
                    report: confirmationReport,
                    successEventId: relation.event_id,
                    failureEventId: relation.eventId,
                    interactionRoomId: roomId
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
    private async executeAction({ label, report, successEventId, failureEventId, onSuccessRemoveEventId, interactionRoomId }: { label: string, report: IReportWithAction, successEventId: string, failureEventId: string, onSuccessRemoveEventId?: string, interactionRoomId: string }) {
        let action: IUIAction<Owner> | undefined = this.actions.get(label);
        if (!action) {
            return;
        }
        let error: any = null;
        let response;
        try {
            // Check security.
            if (interactionRoomId === this.interactionRoomId) {
                // Always accept actions executed from the interaction room.
            } else {
                throw new Error("Security error: Cannot execute this action.");
            }
            response = await action.execute(this.owner, report, interactionRoomId, this);
        } catch (ex) {
            error = ex;
        }
        if (error) {
            this.owner.mjolnir.client.sendEvent(this.interactionRoomId, "m.reaction", {
                "m.relates_to": {
                    "rel_type": "m.annotation",
                    "event_id": failureEventId,
                    "key": `${action.emoji} ❌`
                }
            });
            this.owner.mjolnir.client.sendEvent(this.interactionRoomId, "m.notice", {
                "body": error.message || "<unknown error>",
                "m.relationship": {
                    "rel_type": "m.reference",
                    "event_id": failureEventId,
                }
            })
        } else {
            this.owner.mjolnir.client.sendEvent(this.interactionRoomId, "m.reaction", {
                "m.relates_to": {
                    "rel_type": "m.annotation",
                    "event_id": successEventId,
                    "key": `${action.emoji} ✅`
                }
            });
            if (onSuccessRemoveEventId) {
                this.owner.mjolnir.client.redactEvent(this.interactionRoomId, onSuccessRemoveEventId, "Action complete");
            }
            if (response) {
                this.owner.mjolnir.client.sendMessage(this.interactionRoomId, {
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
}

/**
 * UI action: Help.
 */
export class Help<Owner extends { mjolnir: Mjolnir }> implements IUIAction<Owner> {
    public readonly label = "help";
    public readonly emoji = "❓";
    public readonly needsConfirmation = false;
    private readonly actionsMap: Map<string, IUIAction<Owner>>;
    constructor(actions: Actions<Owner>) {
        this.actionsMap = new Map(actions);
    }
    public async canExecute(_manager: Owner, _report: IReport): Promise<boolean> {
        return true;
    }
    public async title(_manager: Owner, _report: IReport): Promise<string> {
        return "Help";
    }
    public async help(_manager: Owner, _report: IReport): Promise<string> {
        return "This help";
    }
    public async execute(manager: Owner, report: IReport, moderationRoomId: string): Promise<string | undefined> {
        // Produce a html list of actions, in the order specified by ACTION_LIST.
        let list: string[] = [];
        for (let action of this.actionsMap.values()) {
            if (await action.canExecute(manager, report, moderationRoomId)) {
                list.push(`<li>${action.emoji} ${await action.help(manager, report)}</li>`);
            }
        }
        if (!await this.actionsMap.get("ban-accused")!.canExecute(manager, report, moderationRoomId)) {
            list.push(`<li>Some actions were disabled because Mjölnir is not moderator in room ${htmlEscape(report.room_alias_or_id)}</li>`)
        }
        let body = `<ul>${list.join("\n")}</ul>`;
        return body;
    }
}
