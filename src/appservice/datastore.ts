import { Client } from "pg";

export interface MjolnirRecord {
    localPart: string,
    owner: string,
    managementRoom: string,
}

export interface DataStore {
    init(): Promise<void>;

    list(): Promise<MjolnirRecord[]>;

    store(mjolnirRecord: MjolnirRecord): Promise<void>;

    lookupByOwner(owner: string): Promise<MjolnirRecord[]>;

    lookupByMxid(mxid: string): Promise<MjolnirRecord[]>;
}

export class PgDataStore implements DataStore {
    private pgClient: Client;

    constructor(connectionString: string) {
        this.pgClient = new Client({ connectionString: connectionString });
    }

    public async init(): Promise<void> {
        await this.pgClient.connect();
    }

    public async list(): Promise<MjolnirRecord[]> {
        const result = await this.pgClient.query<MjolnirRecord>("SELECT mxid, owner, managementRoom FROM mjolnir");

        if (!result.rowCount) {
            return [];
        }

        return result.rows;
    }

    public async store(mjolnirRecord: MjolnirRecord): Promise<void> {
        await this.pgClient.query(
            "INSERT INTO mjolnir (mxid, owner, managementRoom) VALUES ($1, $2, $3)",
            [mjolnirRecord.mxid, mjolnirRecord.owner, mjolnirRecord.managementRoom],
        );
    }

    public async lookupByOwner(owner: string): Promise<MjolnirRecord[]> {
        const result = await this.pgClient.query<MjolnirRecord>(
            "SELECT mxid, owner FROM mjolnir WHERE owner = $1",
            [owner],
        );

        return result.rows;
    }

    public async lookupByMxid(mxid: string): Promise<MjolnirRecord[]> {
        const result = await this.pgClient.query<MjolnirRecord>(
            "SELECT mxid, owner, managementRoom FROM mjolnir WHERE mxid = $1",
            [mxid],
        );

        return result.rows;
    }
}
