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

import { StringProtectionSetting } from './ProtectionSettings';
import { Mjolnir } from '../Mjolnir';
import { recommendationToStable, RECOMMENDATION_BAN } from '../models/ListRule';
import { logMessage } from '../LogProxy';
import { LogLevel } from 'matrix-bot-sdk';
import { RULE_USER } from '../models/BanList';
import { Protection } from './IProtection';

export class PropagateRoomBan extends Protection {
    settings = {
        banlistShortcode: new StringProtectionSetting(),
    };

    public get name(): string {
        return 'PropagateRoomBan';
    }

    public get description(): string {
        return (
            'If a user is banned in a protected room by a room administrator then the ban ' +
            'will be published to the banlist defined using the banlistShortcode setting.'
        );
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<void> {
        if (!this.isBanEvent(event)) {
            // only interested in ban events
            return;
        }

        const content = event['content'] || {};
        const bannedUser = event['state_key'];
        const banReason = content['reason'] || '<no reason supplied>';
        const sender = event['sender'];
        const stateKey = `rule:${bannedUser}`;

        const ruleContent = {
            entity: bannedUser,
            recommendation: recommendationToStable(RECOMMENDATION_BAN),
            reason: banReason,
        };

        if (this.settings.banlistShortcode.value === '') {
            await logMessage(
                LogLevel.WARN,
                'PropagateRoomBan',
                `Can not publish to banlist. User ${bannedUser} was banned in ${roomId}, but protection setting banlistShortcode is missing`
            );
            return;
        }

        const banlist = mjolnir.lists.find(
            (bl) =>
                bl.listShortcode.toLowerCase() ===
                this.settings.banlistShortcode.value.toLowerCase()
        );

        if (!banlist) {
            await logMessage(
                LogLevel.WARN,
                'PropagateRoomBan',
                `Can not publish to banlist. User ${bannedUser} was banned in ${roomId}, but banlist ${this.settings.banlistShortcode.value} is not found`
            );
            return;
        }

        await mjolnir.client.sendStateEvent(
            banlist.roomId,
            RULE_USER,
            stateKey,
            ruleContent
        );
        await logMessage(
            LogLevel.INFO,
            'PropagateRoomBan',
            `User ${bannedUser} added to banlist ${banlist.listShortcode}, because ${sender} banned him in ${roomId} for: ${banReason}`
        );
    }

    private isBanEvent(event: any): boolean {
        if (event['type'] !== 'm.room.member') {
            return false;
        }

        const membership: string = event['content']['membership'];
        let prevMembership = 'join';

        if (event['unsigned'] && event['unsigned']['prev_content']) {
            prevMembership =
                event['unsigned']['prev_content']['membership'] || 'join';
        }

        return membership === 'ban' && prevMembership !== 'ban';
    }
}
