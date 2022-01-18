import axios from "axios";
import { HmacSHA1 } from "crypto-js";
import { promises as fs } from "fs";
import { LogService, MatrixClient, MemoryStorageProvider, PantalaimonClient, RustSdkCryptoStorageProvider } from "matrix-bot-sdk";
import config from "../../src/config";

const REGISTRATION_ATTEMPTS = 10;
const REGISTRATION_RETRY_BASE_DELAY_MS = 100;
let CryptoStorePaths: string[] = [];

/**
 * Register a user using the synapse admin api that requires the use of a registration secret rather than an admin user.
 * This should only be used by test code and should not be included from any file in the source directory
 * either by explicit imports or copy pasting.
 *
 * @param username The username to give the user.
 * @param displayname The displayname to give the user.
 * @param password The password to use.
 * @param admin True to make the user an admin, false otherwise.
 * @returns The response from synapse.
 */
export async function registerUser(username: string, displayname: string, password: string, admin: boolean) {
    let registerUrl = `${config.homeserverUrl}/_synapse/admin/v1/register`
    let { data } = await axios.get(registerUrl);
    let nonce = data.nonce!;
    let mac = HmacSHA1(`${nonce}\0${username}\0${password}\0${admin ? 'admin' : 'notadmin'}`, 'REGISTRATION_SHARED_SECRET');
    for (let i = 1; i <= REGISTRATION_ATTEMPTS; ++i) {
        try {
            return (await axios.post(registerUrl, {
                nonce,
                username,
                displayname,
                password,
                admin,
                mac: mac.toString()
            })).data;
        } catch (ex) {
            // In case of timeout or throttling, backoff and retry.
            if (ex?.code === 'ESOCKETTIMEDOUT' || ex?.code === 'ETIMEDOUT'
                || ex?.response?.data?.errcode === 'M_LIMIT_EXCEEDED') {
                await new Promise(resolve => setTimeout(resolve, REGISTRATION_RETRY_BASE_DELAY_MS * i * i));
                continue;
            }
            throw ex;
        }
    }
}

export async function getTempCryptoStore() {
    const cryptoDir = await fs.mkdtemp('mjolnir-integration-test');
    CryptoStorePaths.push(cryptoDir);
    return new RustSdkCryptoStorageProvider(cryptoDir);
}

/**
 * Register a new test user with a unique username.
 *
 * @param isAdmin Whether to make the new user an admin.
 * @param label If specified, a string to place somewhere within the username.
 * @returns A string that is the username and password of a new user. 
 */
export async function registerNewTestUser(isAdmin: boolean, label: string = "") {
    let isUserValid = false;
    let username;
    if (label != "") {
        label += "-";
    }
    do {
        username = `mjolnir-test-user-${label}${Math.floor(Math.random() * 100000)}`;
        try {
            const { access_token } = await registerUser(username, username, username, isAdmin);
            isUserValid = true;
            return {username, access_token};
        } catch (e) {
            if (e.isAxiosError && e?.response?.data?.errcode === 'M_USER_IN_USE') {
                LogService.debug("test/clientHelper", `${username} already registered, trying another`);
                // continue and try again
            } else {
                console.error(`failed to register user ${e}`);
                throw e;
            }
        }
    } while (!isUserValid);
}

/**
 * Registers a unique test user and returns a `MatrixClient` logged in and ready to use.
 *
 * @param isAdmin Whether to make the user an admin.
 * @param label If specified, a string to place somewhere within the username.
 * @returns A new `MatrixClient` session for a unique test user.
 */
export async function newTestUser(isAdmin: boolean = false, label: string = ""): Promise<MatrixClient> {
    const { username, access_token } = await registerNewTestUser(isAdmin, label);
    if (config.pantalaimon.use) {
        const pantalaimon = new PantalaimonClient(config.homeserverUrl, new MemoryStorageProvider());
        return await pantalaimon.createClientWithCredentials(username, username);
    } else {
        const client = new MatrixClient(config.homeserverUrl, access_token, new MemoryStorageProvider(), await getTempCryptoStore());
        client.crypto.prepare(await client.getJoinedRooms());
    }
}

/**
 * Utility to create an event listener for m.notice msgtype m.room.messages.
 * @param targetRoomdId The roomId to listen into.
 * @param cb The callback when a m.notice event is found in targetRoomId.
 * @returns The callback to pass to `MatrixClient.on('room.message', cb)`
 */
export function noticeListener(targetRoomdId: string, cb) {
    return (roomId, event) => {
        if (roomId !== targetRoomdId) return;
        if (event?.content?.msgtype !== "m.notice") return;
            cb(event);
    }
}

export async function teardownCryptoStores () {
    await Promise.all(CryptoStorePaths.map(p => fs.rm(p, { force: true, recursive: true})));
    CryptoStorePaths = [];
}