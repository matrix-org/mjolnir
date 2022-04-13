import { MatrixClient } from "matrix-bot-sdk";

/**
 * Returns a promise that resolves to the first event while sending events.
 * @param client A MatrixClient that is already in the targetRoom. We will use it to listen for the event produced by targetEventThunk.
 * This function assumes that the start() has already been called on the client.
 * @param targetRoom The room to listen for the reply in.
 * @param produceEvents A function that produces an events when called.
 * @returns The first event.
 */
export async function getFirstMessage(client: MatrixClient, targetRoom: string, produceEvents: () => Promise<any>): Promise<any> {
    let reactionEvents = [];
    const addEvent = function (roomId, event) {
        if (roomId !== targetRoom) return;
        if (event.type !== 'm.room.message') return;
        reactionEvents.push(event);
    };
    let targetCb;
    try {
        client.on('room.event', addEvent);
        await produceEvents();
        for (let event of reactionEvents) {
            return event;
        }
        return await new Promise(resolve => {
            targetCb = function (roomId, event) {
                if (roomId !== targetRoom) return;
                if (event.type !== 'm.room.message') return;
                resolve(event);
            };
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
 * Returns true if the user got changed to the wanted membership type.
 * @param client A MatrixClient that is already in the targetRoom. We will use it to listen for the event produced by targetEventThunk.
 * This function assumes that the start() has already been called on the client.
 * @param targetRoom The room to listen for the reply in.
 * @param userId The user that should get checked for.
 * @param membership The membership type that the user should get.
 * @returns The first event.
 */
export async function checkMembershipChange(client: MatrixClient, targetRoom: string, userId: string, membership: string): Promise<boolean> {
    let membershipEvents = [];
    const addEvent = function (roomId, event) {
        if (roomId !== targetRoom) return;
        if (event.type !== 'm.room.member') return;
        membershipEvents.push(event);
    };
    let targetCb;
    try {
        client.on('room.event', addEvent);
        for (let event of membershipEvents) {
            if (event.state_key == userId && event.content.membership == membership) {
                return true;
            } else if (event.state_key == userId && event.content.membership != membership) {
                return false;
            }
        }
        return await new Promise(resolve => {
            targetCb = function (roomId, event) {
                if (roomId !== targetRoom) return;
                if (event.type !== 'm.room.member') return;
                if (event.state_key == userId && event.content.membership == membership) {
                    resolve(true);
                } else if (event.state_key == userId && event.content.membership != membership) {
                    resolve(false);
                }
            };
            client.on('room.event', targetCb);
        });
    } finally {
        client.removeListener('room.event', addEvent);
        if (targetCb) {
            client.removeListener('room.event', targetCb);
        }
    }
}