/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import { Client } from "pg";

export interface MjolnirRecord {
    local_part: string,
    owner: string,
    management_room: string,
}

/**
 * Used to persist mjolnirs that have been provisioned by the mjolnir manager.
 */
export interface DataStore {
    /**
     * Initialize any resources that the datastore needs to function.
     */
    init(): Promise<void>;

    /**
     * Close any resources that the datastore is using.
     */
    close(): Promise<void>;

    /**
     * List all of the mjolnirs we have provisioned.
     */
    list(): Promise<MjolnirRecord[]>;

    /**
     * Persist a new `MjolnirRecord`.
     */
    store(mjolnirRecord: MjolnirRecord): Promise<void>;

    /**
     * @param owner The mxid of the user who provisioned this mjolnir.
     */
    lookupByOwner(owner: string): Promise<MjolnirRecord[]>;

    /**
     * @param localPart the mxid of the provisioned mjolnir.
     */
    lookupByLocalPart(localPart: string): Promise<MjolnirRecord[]>;
}

export class PgDataStore implements DataStore {
    private pgClient: Client;

    constructor(connectionString: string) {
        this.pgClient = new Client({ connectionString: connectionString });
    }

    public async init(): Promise<void> {
        await this.pgClient.connect();
    }

    public async close(): Promise<void> {
        await this.pgClient.end()
    }

    public async list(): Promise<MjolnirRecord[]> {
        const result = await this.pgClient.query<MjolnirRecord>("SELECT local_part, owner, management_room FROM mjolnir");

        if (!result.rowCount) {
            return [];
        }

        return result.rows;
    }

    public async store(mjolnirRecord: MjolnirRecord): Promise<void> {
        await this.pgClient.query(
            "INSERT INTO mjolnir (local_part, owner, management_room) VALUES ($1, $2, $3)",
            [mjolnirRecord.local_part, mjolnirRecord.owner, mjolnirRecord.management_room],
        );
    }

    public async lookupByOwner(owner: string): Promise<MjolnirRecord[]> {
        const result = await this.pgClient.query<MjolnirRecord>(
            "SELECT local_part, owner, management_room FROM mjolnir WHERE owner = $1",
            [owner],
        );

        return result.rows;
    }

    public async lookupByLocalPart(localPart: string): Promise<MjolnirRecord[]> {
        const result = await this.pgClient.query<MjolnirRecord>(
            "SELECT local_part, owner, management_room FROM mjolnir WHERE local_part = $1",
            [localPart],
        );

        return result.rows;
    }
}
