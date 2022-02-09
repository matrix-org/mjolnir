import { LogService } from "matrix-bot-sdk";
import { Mjolnir } from "../Mjolnir";
import BanList from "../models/BanList";

/**
 * 
 */
export const batchedSyncWithBanList: ((mjolnir: Mjolnir, banList: BanList, updateEventId: string) => Promise<void>) = (() => {
    // A Map of ban list room ids and the event id of the policy event that was most recently sent there.
    // When the batcher has finished waiting, it will remove the entry for a banlist BEFORE it syncs Mjolnir with it.
    const queuedListUpdates: Map<string, string> = new Map();
    const waitPeriod = 200; // 200ms seems good enough.
    const maxWait = 3000; // 3s is long enough to wait while batching.

    return async function(mjolnir: Mjolnir, banList: BanList, eventId: string) {
        // 
        if (queuedListUpdates.has(banList.roomId)) {
            queuedListUpdates.set(banList.roomId, eventId);
            return;
        }
        queuedListUpdates.set(banList.roomId, eventId);

        let start = Date.now();
        do {
            await new Promise(resolve => setTimeout(resolve, waitPeriod));
        } while ((Date.now() - start) < maxWait && queuedListUpdates.get(banList.roomId) !== eventId)
        queuedListUpdates.delete(banList.roomId);

        try {
            await mjolnir.immediateSyncWithBanList(banList)
        } catch (e) {
            LogService.error('Mjolnir.syncForUpdatedPolicyRoom', `Error syncing BanList ${banList.roomId}: `, e);
        }
    }
})()