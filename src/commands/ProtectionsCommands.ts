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

import { htmlEscape } from "../utils";
import { Mjolnir } from "../Mjolnir";
import { extractRequestError, LogService, RichReply } from "matrix-bot-sdk";
import { isListSetting } from "../protections/ProtectionSettings";

// !mjolnir enable <protection>
export async function execEnableProtection(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    try {
        await mjolnir.protectionManager.enableProtection(parts[2]);
        await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
    } catch (e) {
        LogService.error("ProtectionsCommands", extractRequestError(e));

        const message = `Error enabling protection '${parts[0]}' - check the name and try again.`;
        const reply = RichReply.createFor(roomId, event, message, message);
        reply["msgtype"] = "m.notice";
        await mjolnir.client.sendMessage(roomId, reply);
    }
}

enum ConfigAction {
    Set,
    Add,
    Remove
}

/*
 * Process a given ConfigAction against a given protection setting
 *
 * @param mjolnir Current Mjolnir instance
 * @param parts Arguments given to the command being processed
 * @param action Which ConfigAction to do to the provided protection setting
 * @returns Command success or failure message
 */
async function _execConfigChangeProtection(mjolnir: Mjolnir, parts: string[], action: ConfigAction): Promise<string> {
    const [protectionName, ...settingParts] = parts[0].split(".");
    const protection = mjolnir.protectionManager.getProtection(protectionName);
    if (!protection) {
        return `Unknown protection ${protectionName}`;
    }

    const defaultSettings = protection.settings
    const settingName = settingParts[0];
    const stringValue = parts[1];

    if (!(settingName in defaultSettings)) {
        return `Unknown setting ${settingName}`;
    }

    const parser = defaultSettings[settingName];
    // we don't need to validate `value`, because mjolnir.setProtectionSettings does
    // it for us (and raises an exception if there's a problem)
    let value = parser.fromString(stringValue);

    if (action === ConfigAction.Add) {
        if (!isListSetting(parser)) {
            return `Setting ${settingName} isn't a list`;
        } else {
            value = parser.addValue(value);
        }
    } else if (action === ConfigAction.Remove) {
        if (!isListSetting(parser)) {
            return `Setting ${settingName} isn't a list`;
        } else {
            value = parser.removeValue(value);
        }
    }

    try {
        await mjolnir.protectionManager.setProtectionSettings(protectionName, { [settingName]: value });
    } catch (e) {
        return `Failed to set setting: ${e.message}`;
    }

    const oldValue = protection.settings[settingName].value;
    protection.settings[settingName].setValue(value);

    return `Changed ${protectionName}.${settingName} to ${value} (was ${oldValue})`;
}

/*
 * Change a protection setting
 *
 * !mjolnir set <protection name>.<setting name> <value>
 */
export async function execConfigSetProtection(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const message = await _execConfigChangeProtection(mjolnir, parts, ConfigAction.Set);

    const reply = RichReply.createFor(roomId, event, message, message);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}

/*
 * Add a value to a protection list setting
 *
 * !mjolnir add <protection name>.<setting name> <value>
 */
export async function execConfigAddProtection(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const message = await _execConfigChangeProtection(mjolnir, parts, ConfigAction.Add);

    const reply = RichReply.createFor(roomId, event, message, message);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}

/*
 * Remove a value from a protection list setting
 *
 * !mjolnir remove <protection name>.<setting name> <value>
 */
export async function execConfigRemoveProtection(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const message = await _execConfigChangeProtection(mjolnir, parts, ConfigAction.Remove);

    const reply = RichReply.createFor(roomId, event, message, message);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}

/*
 * Get all protection settings or get all settings for a given protection
 *
 * !mjolnir get [protection name]
 */
export async function execConfigGetProtection(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    let pickProtections = Array.from(mjolnir.protectionManager.protections.keys());

    if (parts.length === 0) {
        // no specific protectionName provided, show all of them.

        // sort output by protection name
        pickProtections.sort();
    } else {
        if (!pickProtections.includes(parts[0])) {
            const errMsg = `Unknown protection: ${parts[0]}`;
            const errReply = RichReply.createFor(roomId, event, errMsg, errMsg);
            errReply["msgtype"] = "m.notice";
            await mjolnir.client.sendMessage(roomId, errReply);
            return;
        }
        pickProtections = [parts[0]];
    }

    let text = "Protection settings\n";
    let html = "<b>Protection settings<b><br /><ul>";

    let anySettings = false;

    for (const protectionName of pickProtections) {
        const protectionSettings = mjolnir.protectionManager.getProtection(protectionName)?.settings ?? {};

        if (Object.keys(protectionSettings).length === 0) {
            continue;
        }

        const settingNames = Object.keys(protectionSettings);
        // this means, within each protection name, setting names are sorted
        settingNames.sort();
        for (const settingName of settingNames) {
            anySettings = true;

            let value = protectionSettings[settingName].value.toString();
            text += `* ${protectionName}.${settingName}: ${value}`;
            // `protectionName` and `settingName` are user-provided but
            // validated against the names of existing protections and their
            // settings, so XSS is avoided for these already
            html += `<li><code>${protectionName}.${settingName}</code>: <code>${htmlEscape(value)}</code></li>`;
        }
    }

    html += "</ul>";

    if (!anySettings)
        html = text = "No settings found";

    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}

// !mjolnir disable <protection>
export async function execDisableProtection(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    await mjolnir.protectionManager.disableProtection(parts[2]);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}

// !mjolnir protections
export async function execListProtections(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const enabledProtections = mjolnir.protectionManager.enabledProtections.map(p => p.name);

    let html = "Available protections:<ul>";
    let text = "Available protections:\n";

    for (const [protectionName, protection] of mjolnir.protectionManager.protections) {
        const emoji = enabledProtections.includes(protectionName) ? '🟢 (enabled)' : '🔴 (disabled)';
        html += `<li>${emoji} <code>${protectionName}</code> - ${protection.description}</li>`;
        text += `* ${emoji} ${protectionName} - ${protection.description}\n`;
    }

    html += "</ul>";

    const reply = RichReply.createFor(roomId, event, text, html);
    reply["msgtype"] = "m.notice";
    await mjolnir.client.sendMessage(roomId, reply);
}
