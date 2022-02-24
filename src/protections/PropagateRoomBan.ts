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

import { Protection } from './IProtection';
import { Mjolnir } from '../Mjolnir';
import { StringProtectionSetting } from './ProtectionSettings';
import { LogLevel, extractRequestError } from 'matrix-bot-sdk';
import { recommendationToStable, RECOMMENDATION_BAN } from '../models/ListRule';
import { RULE_USER } from '../models/BanList';
import { DEFAULT_LIST_EVENT_TYPE } from '../commands/SetDefaultBanListCommand';

export class PropagateRoomBan extends Protection {
    settings = {
        banListShortcode: new StringProtectionSetting(),
    };

    public get name(): string {
        return 'PropagateRoomBan';
    }

    public get description(): string {
        return (
            'If a user is banned in a protected room by a room administrator then the ban ' +
            'will be published to the banlist defined using the banListShortcode setting ' +
            '(defaults to the default banlist).'
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

        let banListShortcode: string = this.settings.banListShortcode.value;
        if (banListShortcode === '') {
            // try to use default banList
            try {
                const data: { shortcode: string } =
                    await mjolnir.client.getAccountData(
                        DEFAULT_LIST_EVENT_TYPE
                    );
                banListShortcode = data['shortcode'];
            } catch (e) {
                await mjolnir.logMessage(
                    LogLevel.WARN,
                    'PropagateRoomBan',
                    `Can not publish to banlist. User ${bannedUser} was banned in ${roomId}, but protection setting banListShortcode is missing and could not get default banlist`
                );
                await mjolnir.logMessage(
                    LogLevel.WARN,
                    'PropagateRoomBan',
                    extractRequestError(e)
                );
                return;
            }
        }

        const banlist = mjolnir.lists.find(
            (bl) =>
                bl.listShortcode.toLowerCase() ===
                banListShortcode.toLowerCase()
        );

        if (!banlist) {
            await mjolnir.logMessage(
                LogLevel.WARN,
                'PropagateRoomBan',
                `Can not publish to banlist. User ${bannedUser} was banned in ${roomId}, but banlist ${banListShortcode} is not found`
            );
            return;
        }

        await mjolnir.client.sendStateEvent(
            banlist.roomId,
            RULE_USER,
            stateKey,
            ruleContent
        );
        await mjolnir.logMessage(
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
