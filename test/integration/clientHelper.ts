import { HmacSHA1 } from "crypto-js";
import {
    getRequestFn,
    LogService,
    MatrixClient,
    MemoryStorageProvider,
    PantalaimonClient,
    RustSdkCryptoStorageProvider
} from "@vector-im/matrix-bot-sdk";
import { promises as fs } from "fs";

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
export async function registerUser(homeserver: string, username: string, displayname: string, password: string, admin: boolean): Promise<any> {
    let registerUrl = `${homeserver}/_synapse/admin/v1/register`
    const data: {nonce: string} = await new Promise((resolve, reject) => {
        getRequestFn()({uri: registerUrl, method: "GET", timeout: 60000}, (error: any, response: any, resBody: any) => {
            error ? reject(error) : resolve(JSON.parse(resBody))
        });
    });
    const nonce = data.nonce!;
    let mac = HmacSHA1(`${nonce}\0${username}\0${password}\0${admin ? 'admin' : 'notadmin'}`, 'REGISTRATION_SHARED_SECRET');
    for (let i = 1; i <= REGISTRATION_ATTEMPTS; ++i) {
        const params = {
                uri: registerUrl,
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    nonce,
                    username,
                    displayname,
                    password,
                    admin,
                    mac: mac.toString()
                }),
                timeout: 60000
            }
        try {
            return await new Promise((resolve, reject) => {
                getRequestFn()(params, (error: any, response: any, respBody: any) => {
                    if (error) {
                        reject(error)
                    }
                    if (response.statusCode != 200) {
                        reject(JSON.parse(response.body))
                    }
                    resolve(JSON.parse(respBody));
                });
            });
        } catch (ex) {
            let err;
            if (ex instanceof Error) {
                err = ex.body.errcode
            } else {
                err = ex.errcode
            }
            // In case of timeout or throttling, backoff and retry.
            if (err === 'ESOCKETTIMEDOUT' || err === 'ETIMEDOUT'
                || err === 'M_LIMIT_EXCEEDED') {
                await new Promise(resolve => setTimeout(resolve, REGISTRATION_RETRY_BASE_DELAY_MS * i * i));
                continue;
            }
            if (err === 'M_USER_IN_USE') {
                console.log("logging in")
                const loginUrl = `${homeserver}/_matrix/client/r0/login`
                const params = {
                    uri: loginUrl,
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({
                        "type": "m.login.password",
                        "identifier": {
                          "type": "m.id.user",
                          "user": username
                        },
                        "password": password
                    }),
                    timeout: 60000
                }
                return await new Promise((resolve, reject) => {
                    getRequestFn()(params, (error: any, result: any, respBody: any) => {
                        let resp = JSON.parse(respBody)
                        console.log(resp)
                        error ? reject(error) : resolve(resp.access_token)
                    });
                });
            }
            throw ex;
        }
    }
    throw new Error(`Retried registration ${REGISTRATION_ATTEMPTS} times, is Mjolnir or Synapse misconfigured?`);
}

export type RegistrationOptions = {
    /**
     * If specified and true, make the user an admin.
     */
    isAdmin?: boolean,
    /**
     * If `exact`, use the account with this exact name, attempting to reuse
     * an existing account if possible.
     *
     * If `contains` create a new account with a name that contains this
     * specific string.
     */
    name: { exact: string } | { contains: string },
    /**
     * If specified and true, throttle this user.
     */
    isThrottled?: boolean
}

/**
 * Register a new test user.
 *
 * @returns A string that is both the username and password of a new user.
 */
async function registerNewTestUser(homeserver: string, options: RegistrationOptions) {
    do {
        let username;
        if ("exact" in options.name) {
            username = options.name.exact;
        } else {
            username = `mjolnir-test-user-${options.name.contains}${Math.floor(Math.random() * 100000)}`
        }
        try {
            await registerUser(homeserver, username, username, username, Boolean(options.isAdmin));
            return username;
        } catch (e) {
            if (e?.body?.errcode === 'M_USER_IN_USE') {
                if ("exact" in options.name) {
                    LogService.debug("test/clientHelper", `${username} already registered, reusing`);
                    return username;
                } else {
                    LogService.debug("test/clientHelper", `${username} already registered, trying another`);
                }
            } else {
                console.error(`failed to register user ${e}`);
                throw e;
            }
        }
    } while (true);
}

/**
 * Registers a test user and returns a `MatrixClient` logged in and ready to use.
 *
 * @returns A new `MatrixClient` session for a unique test user.
 */
export async function newTestUser(homeserver: string, options: RegistrationOptions): Promise<MatrixClient> {
    const username = await registerNewTestUser(homeserver, options);
    const pantalaimon = new PantalaimonClient(homeserver, new MemoryStorageProvider());
    const client = await pantalaimon.createClientWithCredentials(username, username);
    if (!options.isThrottled) {
        let userId = await client.getUserId();
        await overrideRatelimitForUser(homeserver, userId);
    }
    return client;
}

let _globalAdminUser: MatrixClient;

/**
 * Get a client that can perform synapse admin API actions.
 * @returns A client logged in with an admin user.
 */
async function getGlobalAdminUser(homeserver: string): Promise<MatrixClient> {
    // Initialize global admin user if needed.
    if (!_globalAdminUser) {
        const USERNAME = "mjolnir-test-internal-admin-user";
        try {
            await registerUser(homeserver, USERNAME, USERNAME, USERNAME, true);
        } catch (e) {
            if (e.isAxiosError && e?.response?.data?.errcode === 'M_USER_IN_USE') {
                // Then we've already registered the user in a previous run and that is ok.
            } else {
                throw e;
            }
        }
        _globalAdminUser = await new PantalaimonClient(homeserver, new MemoryStorageProvider()).createClientWithCredentials(USERNAME, USERNAME);
    }
    return _globalAdminUser;
}

/**
 * Disable ratelimiting for this user in Synapse.
 * @param userId The user to disable ratelimiting for, has to include both the server part and local part.
 */
export async function overrideRatelimitForUser(homeserver: string, userId: string) {
    await (await getGlobalAdminUser(homeserver)).doRequest("POST", `/_synapse/admin/v1/users/${userId}/override_ratelimit`, null, {
        "messages_per_second": 0,
        "burst_count": 0
    });
}

/**
 * Put back the default ratelimiting for this user in Synapse.
 * @param userId The user to use default ratelimiting for, has to include both the server part and local part.
 */
export async function resetRatelimitForUser(homeserver: string, userId: string) {
    await (await getGlobalAdminUser(homeserver)).doRequest("DELETE", `/_synapse/admin/v1/users/${userId}/override_ratelimit`, null);
}


/**
 * Utility to create an event listener for m.notice msgtype m.room.messages.
 * @param targetRoomdId The roomId to listen into.
 * @param cb The callback when a m.notice event is found in targetRoomId.
 * @returns The callback to pass to `MatrixClient.on('room.message', cb)`
 */
export function noticeListener(targetRoomdId: string, cb: (event: any) => void) {
    return (roomId: string, event: any) => {
        if (roomId !== targetRoomdId) return;
        if (event?.content?.msgtype !== "m.notice") return;
            cb(event);
    }
}

export async function teardownCryptoStores () {
    await Promise.all(CryptoStorePaths.map(p => fs.rm(p, { force: true, recursive: true})));
    CryptoStorePaths = [];
}

export async function getTempCryptoStore() {
    const cryptoDir = await fs.mkdtemp('mjolnir-integration-test');
    CryptoStorePaths.push(cryptoDir);
    return new RustSdkCryptoStorageProvider(cryptoDir, 0);
}