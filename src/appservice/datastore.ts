import { Client } from "pg";

export interface MjolnirRecord {
    local_part: string,
    owner: string,
    management_room: string,
}

export interface DataStore {
    init(): Promise<void>;

    list(): Promise<MjolnirRecord[]>;

    store(mjolnirRecord: MjolnirRecord): Promise<void>;

    lookupByOwner(owner: string): Promise<MjolnirRecord[]>;

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
