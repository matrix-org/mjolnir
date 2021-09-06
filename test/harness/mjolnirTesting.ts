import * as compose from 'docker-compose';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as HmacSHA1 from 'crypto-js/hmac-sha1';
import axios from 'axios';
import config from "../../src/config";
const composeConfig =  path.join(__dirname, '../../docker-compose.test.yaml');

async function synapseGenerate() {
    let synapseEnv = path.join(__dirname, 'config/synapse/synapse.env');
    await fs.writeFile(synapseEnv, `UID=${process.getuid()}\n\
GID=${process.getuid()}\n\
SYNAPSE_SERVER_NAME=localhost:9999
SYNAPSE_REPORT_STATS=no\n\
SYNAPSE_CONFIG_DIR=/data`);
    console.log('generating synapse keys');
    await compose.run('synapse_release', 'generate', {config: composeConfig, log:true});
    console.log(process.env.NODE_ENV)
}

// create synapase-data directory
// copy config to it
async function configureSynapseData() {
    let synapseData = path.join(__dirname, 'synapse-data');
    let synapseConfig = path.join(__dirname, 'config/synapse');
    await fs.mkdir(synapseData).catch(e => {
        if (e.code === 'EEXIST') {
            console.debug('synapse-data already exists')
         } else {
            throw e
         }
        }
    );
    await fs.mkdir(path.join(synapseData, 'media_store')).catch (e => {
        if (e.code === 'EEXIST') {
            console.debug('media_store already exists')
        } else {
            throw e
        }
    });
    await fs.copyFile(path.join(synapseConfig, 'homeserver.yaml'),
    path.join(synapseData, "homeserver.yaml"));
}

async function startSynpase() {
    await synapseGenerate();
    console.info('starting synapse.')
    await compose.upOne('synapse_release', {config: composeConfig, log: true})
    await registerTestUser();
}

async function configureMjolnir() {
    // do we want to clean mjolnir everytime?
    //await fs.rm('synapse-data', {recursive: true, force: true});
    await fs.mkdir(path.join(__dirname, 'mjolnir-data')).catch (e => {
        if (e.code === 'EEXIST') {
            console.debug('mjolnir-data already exists')
        } else {
            throw e
        }
    });

    // now we need to setup the management room alias that it should join.
    // just make bot sdk and make it here or something
    // or we should probably have a generic setup module.

}

async function startMjolnir() {
    await configureMjolnir();
    console.info('starting mjolnir');
    // will not work without some additonal config, but also it isn't useful to debug like this.
    // it would be nice if there was a way to run tests and mjolnir in the same process
    // to assist with debugging
    //await compose.upOne('mjolnir', {config: composeConfig, log: true})
    await import('../../src/index');
}

async function cleanUpSynpase() {
    await fs.rm('synapse-data', {recursive: true, force: true});
}

async function registerUser(username: string, displayname: string, password: string, admin: boolean) {
    let registerUrl = `${config.homeserverUrl}/_synapse/admin/v1/register`
    console.log(registerUrl);
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
    }).catch(e => {
        if (e.isAxiosError && e.response.data.errcode === 'M_USER_IN_USE') {
            console.log('user already registered, skipping')
        } else {
            throw e;
        }
    });
}

async function registerTestUser() {
    return await registerUser('mjolnir', 'mjolnir', 'mjolnir', true);
}

export async function upHarness() {
    try {
    await configureSynapseData();
    await startSynpase();
    // this doesn't actually seem to be implented by the library authors (at least it doesn't do what you'd expect)?
    // see their github issue https://github.com/PDMLab/docker-compose/issues/127
    //await compose.logs(['mjolnir', 'synapse_release'], {config: composeConfig, follow: true});
    } catch (e) {
        console.error(e);
        throw e;
    }
    await startMjolnir();
}

export async function downHarness() {
    await cleanUpSynpase();
}

