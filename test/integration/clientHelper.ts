import axios from "axios";
import { HmacSHA1 } from "crypto-js";
import { MatrixClient, MemoryStorageProvider, PantalaimonClient } from "matrix-bot-sdk";
import config from "../../src/config";

export async function registerUser(username: string, displayname: string, password: string, admin: boolean) {
    let registerUrl = `${config.homeserverUrl}/_synapse/admin/v1/register`
    let { data } = await axios.get(registerUrl);
    let nonce = data.nonce!;
    let mac = HmacSHA1(`${nonce}\0${username}\0${password}\0${admin ? 'admin' : 'notadmin'}`, 'REGISTRATION_SHARED_SECRET');
    return await axios.post(registerUrl, {
        nonce,
        username,
        displayname,
        password,
        admin,
        mac: mac.toString()
    })
}

/**
 * Register a new test user with a unique username.
 * @param isAdmin Whether to make the new user an admin.
 * @returns A string that is the username and password of a new user. 
 */
export async function registerNewTestUser(isAdmin: boolean) {
    let isUserValid = false;
    let username;
    do {
        username = `test-user-${Math.floor(Math.random() * 100000)}`
        await registerUser(username, username, username, isAdmin).then(_ => isUserValid = true).catch(e => {
            if (e.isAxiosError && e.response.data.errcode === 'M_USER_IN_USE') {
                // FIXME: Replace with the real logging service.
                console.log(`${username} already registered, trying another`);
                false // continue and try again
            } else {
                console.error(`failed to register user ${e}`);
                throw e;
            }
        })
    } while (!isUserValid);
    return username;
} 

export async function newTestUser(isAdmin?: boolean): Promise<MatrixClient> {
    const username = await registerNewTestUser(isAdmin);
    const pantalaimon = new PantalaimonClient(config.homeserverUrl, new MemoryStorageProvider());
    return await pantalaimon.createClientWithCredentials(username, username);
}

export function noticeListener(targetRoomdId: string, cb) {
    return (roomId, event) => {
        if (roomId !== targetRoomdId) return;
        if (event?.content?.msgtype !== "m.notice") return;
            cb(event);
    } 
}