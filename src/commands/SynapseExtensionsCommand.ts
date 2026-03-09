/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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

import { Mjolnir } from "../Mjolnir";

type SynapseAdminConfig = {
    return_soft_failed_events?: boolean;
    return_policy_server_spammy_events?: boolean;
};

const SYNAPSE_ADMIN_ACCOUNT_DATA_TYPE = "io.element.synapse.admin_client_config";

// !mjolnir synapse_ext <'policy_server_spammy'> <true|false>
export async function execSynapseExtensionsCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const extension = parts[2];

    if (extension === "policy_server_spammy") {
        let currentConfig: SynapseAdminConfig = {};
        try {
            currentConfig = await mjolnir.client.getAccountData(SYNAPSE_ADMIN_ACCOUNT_DATA_TYPE);
        } catch (e) {
            // assume unset
        }
        await mjolnir.client.setAccountData(SYNAPSE_ADMIN_ACCOUNT_DATA_TYPE, {
            return_soft_failed_events: currentConfig.return_soft_failed_events ?? false,
            return_policy_server_spammy_events: parts[3] === "true",
        });
        await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
    } else {
        await mjolnir.client.replyNotice(roomId, event, "Unknown extension, please check the help for more information.");
    }
}
