import { Protection } from './IProtection';
import { NumberProtectionSetting } from './ProtectionSettings';
import { Mjolnir } from '../Mjolnir';
import { LogLevel, LogService } from 'matrix-bot-sdk';
import { isTrueJoinEvent } from '../utils';

// We ban user if they mention more or equal to this ratio
export const DEFAULT_MAX_MENTIONS = 5;

// Default regexes
const LOCALPART_REGEX = "[0-9a-z-.=_/]+";
const DOMAIN_REGEX = "(\\b((?=[a-z0-9-]{1,63}\\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\\.)+[a-z]{2,63}\\b)";
const IPV4_REGEX = "(((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))";
const IPV6_REGEX = "(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))";
const PORT_REGEX = "(:[0-9]+)?";

export class MentionFlood extends Protection {
    settings = {
        maxMentions: new NumberProtectionSetting(DEFAULT_MAX_MENTIONS)
    };

    private justJoined: { [roomId: string]: { [username: string]: Date } } = {};
    private mention: RegExp;

    constructor() {
        super();
        this.mention = new RegExp(`@${LOCALPART_REGEX}:(${DOMAIN_REGEX}|${IPV4_REGEX}|${IPV6_REGEX})${PORT_REGEX}`, "gi");
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

        if (minsBeforeTrusting > 0) {
            if (!this.justJoined[roomId]) this.justJoined[roomId] = {};

            if (event['type'] === 'm.room.member') {
                if (isTrueJoinEvent(event)) {
                    this.justJoined[roomId][event['state_key']] = now;
                    LogService.info("MentionFlood", `${event['state_key']} joined ${roomId} at ${now.toDateString()}`);
                } else if (content['membership'] === 'leave' || content['membership'] === 'ban') {
                    delete this.justJoined[roomId][event['sender']]
                }

                return;
            }
        }

        if (event['type'] !== 'm.room.message') return;

        const message: string = content['formatted_body'] || content['body'] || null;

        if (minsBeforeTrusting < 0) return;
        const joinTime = this.justJoined[roomId][event['sender']]
        if ((joinTime && (now.valueOf() - joinTime.valueOf() > minsBeforeTrusting * 60 * 1000)) || !joinTime) return;

        const maxMentionsPerMessage = this.settings.maxMentions.value;
        if (message && (message.match(this.mention)?.length || 0) > maxMentionsPerMessage) {
            await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionFlood", `Banning ${event['sender']}`);
            if (!mjolnir.config.noop) {
                await mjolnir.client.banUser(event['sender'], `Banning ${event['sender']} for mention flood in ${roomId}`);
                await mjolnir.client.redactEvent(roomId, event['event_id'], "spam");
            } else {
                await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "MentionFlood", `Tried to ban ${event['sender']} for mention flood in ${roomId} but Mjolnir is running in no-op mode.`);
            }
        }
    }
}
