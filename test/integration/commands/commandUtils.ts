import { MatrixClient } from "matrix-bot-sdk";
import { strict as assert } from "assert";
import * as crypto from "crypto";

/**
 * Returns a promise that resolves to the first event replying to the event produced by targetEventThunk.
 * @param client A MatrixClient that is already in the targetRoom. We will use it to listen for the event produced by targetEventThunk.
 * This function assumes that the start() has already been called on the client.
 * @param targetRoom The room to listen for the reply in.
 * @param targetEventThunk A function that produces an event ID when called. This event ID is then used to listen for a reply.
 * @returns The replying event.
 */
 export async function getFirstReply(client: MatrixClient, targetRoom: string, targetEventThunk: () => Promise<string>): Promise<any> {
    let reactionEvents = [];
    const addEvent = function (roomId, event) {
        if (roomId !== targetRoom) return;
        if (event.type !== 'm.room.message') return;
        reactionEvents.push(event);
    };
    let targetCb;
    try {
        client.on('room.event', addEvent)
        const targetEventId = await targetEventThunk();
        for (let event of reactionEvents) {
            const in_reply_to = event.content['m.relates_to']?.['m.in_reply_to'];
            if (in_reply_to?.event_id === targetEventId) {
                return event;
            }
        }
        return await new Promise(resolve => {
            targetCb = function(roomId, event) {
                if (roomId !== targetRoom) return;
                if (event.type !== 'm.room.message') return;
                const in_reply_to = event.content['m.relates_to']?.['m.in_reply_to'];
                if (in_reply_to?.event_id === targetEventId) {
                    resolve(event)
                }
            }
            client.on('room.event', targetCb);
        });
    } finally {
        client.removeListener('room.event', addEvent);
        if (targetCb) {
            client.removeListener('room.event', targetCb);
        }
    }
}



/**
 * Returns a promise that resolves to an event that is reacting to the event produced by targetEventThunk.
 * @param client A MatrixClient that is already in the targetRoom that can be started to listen for the event produced by targetEventThunk.
 * This function assumes that the start() has already been called on the client.
 * @param targetRoom The room to listen for the reaction in.
 * @param reactionKey The reaction key to wait for.
 * @param targetEventThunk A function that produces an event ID when called. This event ID is then used to listen for a reaction.
 * @returns The reaction event.
 */
export async function getFirstReaction(client: MatrixClient, targetRoom: string, reactionKey: string, targetEventThunk: () => Promise<string>): Promise<any> {
    let reactionEvents = [];
    const addEvent = function (roomId, event) {
        if (roomId !== targetRoom) return;
        if (event.type !== 'm.reaction') return;
        reactionEvents.push(event);
    };
    let targetCb;
    try {
        client.on('room.event', addEvent)
        const targetEventId = await targetEventThunk();
        for (let event of reactionEvents) {
            const relates_to = event.content['m.relates_to'];
            if (relates_to?.event_id === targetEventId && relates_to?.key === reactionKey) {
                return event;
            }
        }
        return await new Promise((resolve, reject) => {
            targetCb = function(roomId, event) {
                if (roomId !== targetRoom) return;
                if (event.type !== 'm.reaction') return;
                const relates_to = event.content['m.relates_to'];
                if (relates_to?.event_id === targetEventId && relates_to?.key === reactionKey) {
                    resolve(event)
                }
            }
            client.on('room.event', targetCb);
        });
    } finally {
        client.removeListener('room.event', addEvent);
        if (targetCb) {
            client.removeListener('room.event', targetCb);
        }
    }
}

/**
 * Create a new banlist for mjolnir to watch and return the shortcode that can be used to refer to the list in future commands.
 * @param managementRoom The room to send the create command to.
 * @param mjolnir A syncing matrix client.
 * @param client A client that isn't mjolnir to send the message with, as you will be invited to the room.
 * @returns The shortcode for the list that can be used to refer to the list in future commands.
 */
export async function createBanList(managementRoom: string, mjolnir: MatrixClient, client: MatrixClient): Promise<string> {
    const listName = crypto.randomUUID();
    const listCreationResponse = await getFirstReply(mjolnir, managementRoom, async () => {
        return await client.sendMessage(managementRoom, { msgtype: 'm.text', body: `!mjolnir list create ${listName} ${listName}`});
    });
    assert.equal(listCreationResponse.content.body.includes('This list is now being watched.'), true, 'could not create a list to test with.');
    return listName;
}
