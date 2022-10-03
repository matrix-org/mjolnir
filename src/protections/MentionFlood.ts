import { Protection } from './IProtection';
import { NumberProtectionSetting } from './ProtectionSettings';
import { Mjolnir } from '../Mjolnir';
import { LogLevel, LogService } from 'matrix-bot-sdk';
import { isTrueJoinEvent } from '../utils';
import { ConsequenceBan, ConsequenceRedact } from "./consequence";

export const DEFAULT_MAX_MENTIONS = 5;

export class MentionFlood extends Protection {
    settings = {
        maxMentions: new NumberProtectionSetting(DEFAULT_MAX_MENTIONS)
    };

    private justJoined: { [roomId: string]: { [username: string]: Date} } = {};

    constructor() {
        super();
    }

    public get name(): string {
        return 'MentionFloodProtection';
    }

    public get description(): string {
        return `If an user tries to mention more than ${DEFAULT_MAX_MENTIONS} people, it will ban them automatically. This does not publish the ban to any of your ban lists.`;
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        const content = event['content'] || {};
        const minsBeforeTrusting = mjolnir.config.protections.mentionflood.minutesBeforeTrusting;
        const now = new Date();

        LogService.warn("MentionFlood", event);

        if (minsBeforeTrusting > 0) {
            if (!this.justJoined[roomId]) this.justJoined[roomId] = {};
            if (event['type'] === 'm.room.member') {
                if (isTrueJoinEvent(event)) {
                    this.justJoined[roomId][event['state_key']] = now;
                    LogService.info("WordList", `${event['state_key']} joined ${roomId} at ${now.toDateString()}`);
                } else if (content['membership'] === 'leave' || content['membership'] === 'ban') {
                    delete this.justJoined[roomId][event['sender']];
                }

                return;
            }
        }

        if (event['type'] !== 'm.room.message') return;
        const message: string = content['formatted_body'] || content['body'] || null;

        if (minsBeforeTrusting > 0) {
            const joinTime = this.justJoined[roomId][event['sender']]
            if (joinTime) {
                if (now.valueOf() - joinTime.valueOf() > minsBeforeTrusting * 60 * 1000) {
                    delete this.justJoined[roomId][event['sender']];
                    LogService.info("WordList", `${event['sender']} is no longer considered suspect`);
                    return;
                }

            } else {
                return;
            }
        }

        const maxMentionsPerMessage = this.settings.maxMentions.value;
        if (message && (message.match(/@[^:]*:\S+/gi)?.length || 0) > maxMentionsPerMessage) {
            await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionFlood", `Banning ${event['sender']}`);
            const reason = "spam";
            return [new ConsequenceBan(reason), new ConsequenceRedact(reason)];
        }
    }
}
