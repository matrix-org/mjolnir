import { Mjolnir } from "../Mjolnir";
import { LogLevel } from "matrix-bot-sdk";

const EVENT_MODERATED_BY = "org.matrix.msc3215.room.moderation.moderated_by";
const EVENT_MODERATOR_OF = "org.matrix.msc3215.room.moderation.moderator_of";

// !mjolnir rooms setup <room alias/ID> reporting
export async function execSetupProtectedRoom(commandRoomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    // For the moment, we only accept a subcommand `reporting`.
    if (parts[4] !== 'reporting') {
        await mjolnir.client.sendNotice(commandRoomId, "Invalid subcommand for `rooms setup <room alias/ID> subcommand`, expected one of \"reporting\"");
        await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '❌');
        return;
    }
    const protectedRoomId = await mjolnir.client.joinRoom(parts[3]);

    try {
        const userId = await mjolnir.client.getUserId();

        // A backup of the previous state in case we need to rollback.
        let previousState: /* previous content */ any | /* there was no previous content */ null;
        try {
            previousState = await mjolnir.client.getRoomStateEvent(protectedRoomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY);
        } catch (ex) {
            previousState = null;
        }

        // Setup protected room -> moderation room link.
        // We do this before the other one to be able to fail early if we do not have a sufficient
        // powerlevel.
        let eventId = await mjolnir.client.sendStateEvent(protectedRoomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY, {
            room_id: commandRoomId,
            user_id: userId,
        });

        try {
            // Setup moderation room -> protected room.
            await mjolnir.client.sendStateEvent(commandRoomId, EVENT_MODERATOR_OF, protectedRoomId, {
                user_id: userId,
            });
        } catch (ex) {
            // If the second `sendStateEvent` fails, we could end up with a room half setup, which
            // is bad. Attempt to rollback.
            try {
                if (previousState) {
                    await mjolnir.client.sendStateEvent(protectedRoomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY, previousState);
                } else {
                    await mjolnir.client.redactEvent(protectedRoomId, eventId, "Rolling back incomplete MSC3215 setup");
                }
            } finally {
                // Ignore second exception
                throw ex;
            }
        }

    } catch (ex) {
        mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, "execSetupProtectedRoom", ex.message);
        await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '❌');
    }
    await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
}
