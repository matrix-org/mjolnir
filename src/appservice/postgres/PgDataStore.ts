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

import { PostgresStore, SchemaUpdateFunction } from "matrix-appservice-bridge";
import { DataStore, MjolnirRecord } from "../datastore";

function getSchema(): SchemaUpdateFunction[] {
    const nSchema = 1;
    const schema = [];
    for (let schemaID = 1; schemaID < nSchema + 1; schemaID++) {
        schema.push(require(`./schema/v${schemaID}`).runSchema);
    }
    return schema;
}

export class PgDataStore extends PostgresStore implements DataStore {

    constructor(connectionString: string) {
        super(getSchema(), { url: connectionString })
    }

    public async init(): Promise<void> {
        await this.ensureSchema();
    }

    public async close(): Promise<void> {
        await this.destroy();
    }

    public async list(): Promise<MjolnirRecord[]> {
        const result = await this.sql`SELECT local_part, owner, management_room FROM mjolnir`;
        if (!result.count) {
            return [];
        }

        return result.flat() as MjolnirRecord[];
    }

    public async store(mjolnirRecord: MjolnirRecord): Promise<void> {
        await this.sql`INSERT INTO mjolnir (local_part, owner, management_room)
        VALUES (${mjolnirRecord.local_part}, ${mjolnirRecord.owner}, ${mjolnirRecord.management_room})`;
    }

    public async lookupByOwner(owner: string): Promise<MjolnirRecord[]> {
        const result = await this.sql`SELECT local_part, owner, management_room FROM mjolnir
        WHERE owner = ${owner}`;
        return result.flat() as MjolnirRecord[];
    }

    public async lookupByLocalPart(localPart: string): Promise<MjolnirRecord[]> {
        const result = await this.sql`SELECT local_part, owner, management_room FROM mjolnir
        WHERE local_part = ${localPart}`;
        return result.flat() as MjolnirRecord[];
    }
}
