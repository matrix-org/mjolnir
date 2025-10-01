import { HmacSHA1 } from "crypto-js";
import { MatrixClient, MemoryStorageProvider, RustSdkCryptoStorageProvider } from "@vector-im/matrix-bot-sdk";
import { PathLike, promises as fs } from "fs";
import axios from "axios";

const REGISTRATION_ATTEMPTS = 10;
const REGISTRATION_RETRY_BASE_DELAY_MS = 100;
let CryptoStorePaths: any = [];

/**
 * Register a user using the synapse admin api that requires the use of a registration secret rather than an admin user.
 * This should only be used by test code and should not be included from any file in the source directory
 * either by explicit imports or copy pasting.
 *
 * @param homeserver the homeserver url
 * @param username The username to give the user.
 * @param displayname The displayname to give the user.
 * @param password The password to use.
 * @param admin True to make the user an admin, false otherwise.
 * @returns The access token from logging in.
 */
export async function registerUser(
    homeserver: string,
    username: string,
    displayname: string,
    password: string,
    admin: boolean,
): Promise<string> {
    let registerUrl = `${homeserver}/_synapse/admin/v1/register`;
    const response = await axios({ method: "get", url: registerUrl, timeout: 60000 });
    const nonce = response.data.nonce;
    let mac = HmacSHA1(
        `${nonce}\0${username}\0${password}\0${admin ? "admin" : "notadmin"}`,
        "REGISTRATION_SHARED_SECRET",
    );

    for (let i = 1; i <= REGISTRATION_ATTEMPTS; ++i) {
        const registerConfig = {
            url: registerUrl,
            method: "post",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                nonce,
                username,
                displayname,
                password,
                admin,
                mac: mac.toString(),
            }),
            timeout: 60000,
        };
        try {
            let resp = await axios(registerConfig);
            return resp.data?.access_token;
        } catch (ex: any) {
            const code = ex.response.data.errcode;

            // In case of timeout or throttling, backoff and retry.
            if (code === "ESOCKETTIMEDOUT" || code === "ETIMEDOUT" || code === "M_LIMIT_EXCEEDED") {
                await new Promise((resolve) => setTimeout(resolve, REGISTRATION_RETRY_BASE_DELAY_MS * i * i));
                continue;
            }
            if (code === "M_USER_IN_USE") {
                const loginUrl = `${homeserver}/_matrix/client/r0/login`;
                const loginConfig = {
                    url: loginUrl,
                    method: "post",
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify({
                        type: "m.login.password",
                        identifier: {
                            type: "m.id.user",
                            user: username,
                        },
                        password: password,
                    }),
                    timeout: 60000,
                };
                let resp2 = await axios(loginConfig);
                return resp2.data?.access_token;
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
    isAdmin?: boolean;
    /**
     * If `exact`, use the account with this exact name, attempting to reuse
     * an existing account if possible.
     *
     * If `contains` create a new account with a name that contains this
     * specific string.
     */
    name: { exact: string } | { contains: string };
    /**
     * If specified and true, throttle this user.
     */
    isThrottled?: boolean;
};

/**
 * Register a new test user.
 *
 * @returns an access token for a new test account
 */
async function registerNewTestUser(homeserver: string, options: RegistrationOptions): Promise<string> {
    do {
        let username;
        let accessToken: string;
        if ("exact" in options.name) {
            username = options.name.exact;
        } else {
            username = `mjolnir-test-user-${options.name.contains}${Math.floor(Math.random() * 100000)}`;
        }
        try {
            accessToken = await registerUser(homeserver, username, username, username, Boolean(options.isAdmin));
            return accessToken;
        } catch (e: any) {
            console.error(`failed to register user ${e}`);
            throw e;
        }
    } while (true);
}

/**
 * Registers a test user and returns a `MatrixClient` logged in and ready to use.
 *
 * @returns A new `MatrixClient` session for a unique test user.
 */
export async function newTestUser(
    homeserver: string,
    options: RegistrationOptions,
    encrypted = false,
): Promise<MatrixClient> {
    const accessToken = await registerNewTestUser(homeserver, options);
    let client;
    if (encrypted) {
        const cStore = await getTempCryptoStore();
        client = new MatrixClient(homeserver, accessToken, new MemoryStorageProvider(), cStore);
        await client.crypto.prepare();
    } else {
        client = new MatrixClient(homeserver, accessToken, new MemoryStorageProvider());
    }

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
        let accessToken: string;
        const USERNAME = "mjolnir-test-internal-admin-user";
        accessToken = await registerUser(homeserver, USERNAME, USERNAME, USERNAME, true);
        _globalAdminUser = await new MatrixClient(homeserver, accessToken, new MemoryStorageProvider());
        await _globalAdminUser;
    }
    return _globalAdminUser;
}

/**
 * Disable ratelimiting for this user in Synapse.
 * @param userId The user to disable ratelimiting for, has to include both the server part and local part.
 */
export async function overrideRatelimitForUser(homeserver: string, userId: string) {
    await (
        await getGlobalAdminUser(homeserver)
    ).doRequest("POST", `/_synapse/admin/v1/users/${userId}/override_ratelimit`, null, {
        messages_per_second: 0,
        burst_count: 0,
    });
}

/**
 * Put back the default ratelimiting for this user in Synapse.
 * @param userId The user to use default ratelimiting for, has to include both the server part and local part.
 */
export async function resetRatelimitForUser(homeserver: string, userId: string) {
    await (
        await getGlobalAdminUser(homeserver)
    ).doRequest("DELETE", `/_synapse/admin/v1/users/${userId}/override_ratelimit`, null);
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
    };
}

/**
 * Tears down temporary crypto stores created for testing
 */
export async function teardownCryptoStores() {
    await Promise.all(CryptoStorePaths.map((p: PathLike) => fs.rm(p, { force: true, recursive: true })));
    CryptoStorePaths = [];
}

/**
 * Helper function to create temp crypto store for testing
 */
export async function getTempCryptoStore() {
    const cryptoDir = await fs.mkdtemp("mjolnir-integration-test");
    CryptoStorePaths.push(cryptoDir);
    return new RustSdkCryptoStorageProvider(cryptoDir, 0);
}
