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
import * as htmlEscape from "escape-html";

import config from "../config";
import { Mjolnir } from "../Mjolnir";
import { GUIManager, Help, IReport, IReportWithAction, IUIAction, Kind } from "../gui/GUIManager";
import { getHomeserver } from "../utils";

/// Custom field embedded as part of notifications to embed abuse reports
/// (see `IReport` for the content).
export const ABUSE_REPORT_KEY = "org.matrix.mjolnir.abuse.report";

/// Custom field embedded as part of confirmation reactions to embed abuse
/// reports (see `IReportWithAction` for the content).
export const ABUSE_ACTION_CONFIRMATION_KEY = "org.matrix.mjolnir.action.confirmation";

/**
 * A class designed to respond to abuse reports.
 */
export class ReportManager {
    private guiManager: GUIManager<ReportManager>;
    constructor(public mjolnir: Mjolnir) {
        this.guiManager = new GUIManager({
            owner: this,
            interactionRoomId: config.managementRoom,
            actions: [...ACTIONS],
            reportKey: ABUSE_REPORT_KEY,
            confirmKey: ABUSE_ACTION_CONFIRMATION_KEY
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
        return this.guiManager.displayReportAndUI({ kind: Kind.SERVER_ABUSE_REPORT, event, reporterId, reason, interactionRoomId: config.managementRoom });
    }
}

/**
 * UI action: Ignore bad report
 */
class IgnoreBadReport implements IUIAction<ReportManager> {
    public label = "bad-report";
    public emoji = "🚯";
    public needsConfirmation = true;
    public async canExecute(_manager: ReportManager, _report: IReport): Promise<boolean> {
        return true;
    }
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Ignore";
    }
    public async help(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Ignore bad report";
    }
    public async execute(manager: ReportManager, report: IReportWithAction): Promise<string | undefined> {
        await manager.mjolnir.client.sendEvent(config.managementRoom, "m.room.message",
            {
                msgtype: "m.notice",
                body: "Report classified as invalid",
                "m.new_content": {
                    "body": `Report by user ${report.reporter_id} has been classified as invalid`,
                    "msgtype": "m.text"
                },
                "m.relates_to": {
                    "rel_type": "m.replace",
                    "event_id": report.notification_event_id
                }
            }
        );
        return;
    }
}

/**
 * UI action: Redact reported message.
 */
class RedactMessage implements IUIAction<ReportManager> {
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
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Redact";
    }
    public async help(_manager: ReportManager, report: IReport): Promise<string> {
        return `Redact event ${report.event_id}`;
    }
    public async execute(manager: ReportManager, report: IReport, _moderationRoomId: string): Promise<string | undefined> {
        await manager.mjolnir.client.redactEvent(report.room_id, report.event_id);
        return;
    }
}

/**
 * UI action: Kick accused user.
 */
class KickAccused implements IUIAction<ReportManager> {
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
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Kick";
    }
    public async help(_manager: ReportManager, report: IReport): Promise<string> {
        return `Kick ${htmlEscape(report.accused_id)} from room ${htmlEscape(report.room_alias_or_id)}`;
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        await manager.mjolnir.client.kickUser(report.accused_id, report.room_id);
        return;
    }
}

/**
 * UI action: Mute accused user.
 */
class MuteAccused implements IUIAction<ReportManager> {
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
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Mute";
    }
    public async help(_manager: ReportManager, report: IReport): Promise<string> {
        return `Mute ${htmlEscape(report.accused_id)} in room ${htmlEscape(report.room_alias_or_id)}`;
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        await manager.mjolnir.client.setUserPowerLevel(report.accused_id, report.room_id, -1);
        return;
    }
}

/**
 * UI action: Ban accused.
 */
class BanAccused implements IUIAction<ReportManager> {
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
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Ban";
    }
    public async help(_manager: ReportManager, report: IReport): Promise<string> {
        return `Ban ${htmlEscape(report.accused_id)} from room ${htmlEscape(report.room_alias_or_id)}`;
    }
    public async execute(manager: ReportManager, report: IReport): Promise<string | undefined> {
        await manager.mjolnir.client.banUser(report.accused_id, report.room_id);
        return;
    }
}

/**
 * Escalate to the moderation room of this instance of Mjölnir.
 */
class EscalateToServerModerationRoom implements IUIAction<ReportManager> {
    public label = "escalate-to-server-moderation";
    public emoji = "⏫";
    public needsConfirmation = true;
    public async canExecute(manager: ReportManager, report: IReport, moderationRoomId: string): Promise<boolean> {
        if (moderationRoomId === config.managementRoom) {
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
    public async title(_manager: ReportManager, _report: IReport): Promise<string> {
        return "Escalate";
    }
    public async help(manager: ReportManager, _report: IReport): Promise<string> {
        return `Escalate report to ${getHomeserver(await manager.mjolnir.client.getUserId())} server moderators`;
    }
    public async execute(manager: ReportManager, report: IReport, _moderationRoomId: string, guiManager: GUIManager<ReportManager>): Promise<string | undefined> {
        let event = await manager.mjolnir.client.getEvent(report.room_id, report.event_id);

        // Display the report and UI directly in the management room, as if it had been
        // received from /report.
        //
        // Security:
        // - `kind`: statically known good;
        // - `moderationRoomId`: statically known good;
        // - `reporterId`: we trust `report`, could be forged by a moderator, low impact;
        // - `event`: checked just before.
        await guiManager.displayReportAndUI({ kind: Kind.ESCALATED_REPORT, reporterId: report.reporter_id, interactionRoomId: config.managementRoom, event });
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
];
ACTION_LIST.push(new Help(ACTION_LIST.map(action => [action.label, action])));
/**
 * The actions we may be able to undertake in reaction to a report.
 *
 * As a map of labels => actions.
 */
const ACTIONS = new Map(ACTION_LIST.map(action => [action.label, action]));

