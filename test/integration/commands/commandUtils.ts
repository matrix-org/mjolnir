import { MatrixClient } from "matrix-bot-sdk";

/**
 * Returns a promise that resolves to an event that is reacting to the event produced by targetEventThunk.
 * @param client A MatrixClient that is already in the targetRoom that can be started to listen for the event produced by targetEventThunk.
 * This function assumes that the start() has already been called on the client.
 * @param targetRoom The room to listen for the reaction in.
 * @param reactionKey The reaction key to wait for.
 * @param targetEventThunk A function that produces an event ID when called. This event ID is then used to listen for a reaction.
 * @returns The reaction event.
 */
export async function onReactionTo(client: MatrixClient, targetRoom: string, reactionKey: string, targetEventThunk: () => Promise<string>): Promise<any> {
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
            if (relates_to.event_id === targetEventId && relates_to.key === reactionKey) {
                return event;
            }
        }
        return await new Promise((resolve, reject) => {
            targetCb = function(roomId, event) {
                if (roomId !== targetRoom) return;
                if (event.type !== 'm.reaction') return;
                const relates_to = event.content['m.relates_to'];
                if (relates_to.event_id === targetEventId && relates_to.key === reactionKey) {
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
