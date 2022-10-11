import { MatrixClient, UserID } from "matrix-bot-sdk";

/**
 * A caching layer on top of MatrixClient.
 *
 * This layer is designed to speed up Mjölnir and reduce the load on
 * the homeserver by caching critical data.
 *
 * # Caching policy
 *
 * As an instance of Many-Mjölnir can end up instantiating thousands of
 * instances of `Mjolnir`, we do not wish to cache *everything*. Rather,
 * we cache only data that we know we'll be using repeatedly.
 */
export class CachingClient {
    // The user id. Initialized by `start()`.
    private _userId?: string;
    private _localpart?: string;
    private _displayName?: string | null;
    private _domain?: string;

    // The contents of account data.
    private _accountData: Map<String, AccountDataCache> = new Map();
    private _joinedRooms: Cache<Set<string>>;

    constructor(
        /**
         * The implementation of the MatrixClient
         */
        public readonly uncached: MatrixClient
    ) {}

    /**
     * Initialize this client.
     *
     * This MUST be called once before using the `CachingClient`.
     *
     * Do not forget to call `stop()` at the end.
     */
    public async start() {
        this.uncached.on("account_data", event => {
            if ("type" in event && typeof event.type === "string") {
                this._accountData.set(event.type, event);
            }
        });

        await this.uncached.start();
        if (this._userId) {
            throw new TypeError("Already initialized");
        }
        this._userId = await this.uncached.getUserId();
        let userID = new UserID(this._userId);
        this._localpart = userID.localpart;
        this._domain = userID.domain;
        let profile = await this.uncached.getUserProfile(this._userId);
        this._displayName = profile?.['displayname'] || null;
    }

    /**
     * Stop the client.
     */
    public stop() {
        this.uncached.stop();
        for (let cache of this._accountData.values()) {
            cache.unregister();
        }
        this._accountData.clear();
    }

    /**
     * The user id for this client.
     */
    public get userId(): string {
        return this._userId!;
    }
    public get localpart(): string {
        return this._localpart!;
    }
    public get domain(): string {
        return this._domain!;
    }
    public get displayName(): string | null {
        return this._displayName || null;
    }

    /**
     * Register for knowing about account data of a specific kind.
     * @param type
     */
    public async accountData(type: string): Promise<WritableCache<any>> {
        let cache = this._accountData.get(type);
        if (!cache) {
            let newCache = new AccountDataCache(this.uncached, type);
            await newCache.init();
            this._accountData.set(type, newCache);
            cache = newCache;
        }
        return cache;
    }

    public joinedRooms(): Cache<Set<string>> {
        if (!this._joinedRooms) {
            this._joinedRooms = new JoinedRoomsCache(this.uncached);
        }
        return this._joinedRooms;
    }
}

/**
 * A cached value.
 *
 * Call `get()` to obtain the latest value.
 */
export abstract class Cache<T> {
    _value: T | null;
    public get(): Readonly<T> | null {
        return this._value;
    }
    cache(value: T) {
        this._value = value;
    }
    abstract unregister(): void;
}

export abstract class WritableCache<T> extends Cache<T> {
    abstract send(value: T): Promise<void>;
    public async set(value: T): Promise<T | null> {
        let previous = this.get();
        await this.send(value);
        return previous;
    }
}

/**
 * A cache specialized to store the list of currently joined rooms.
 *
 * `get()` returns a `Set` of room ids for all the rooms currently joined.
 */
class JoinedRoomsCache extends Cache<Set<string>> {
    constructor(private uncached: MatrixClient) {
        super();
    }
    async init() {
        let data = await this.uncached.getJoinedRooms();
        this.cache(new Set(data));
        await this.uncached.on("room.join", this.onJoin);
        await this.uncached.on("room.leave", this.onLeave);
    }
    onJoin = (roomId: string) => {
        this._value?.add(roomId);
    }
    onLeave = (roomId: string) => {
        this._value?.delete(roomId);
    }
    unregister() {
        this.uncached.removeListener("room.join", this.onJoin);
        this.uncached.removeListener("room.join", this.onLeave);
    }
}

/**
 * A cache for account data.
 *
 * One instance of `AccountDataCache` for each `type` of account data watched.
 */
class AccountDataCache extends WritableCache<any> {
    public async send(value: any): Promise<void> {
        await this.uncached.setAccountData(this.type, value);
    }

    constructor(private readonly uncached: MatrixClient, public readonly type: string) {
        super();

    }
    async init() {
        let data;
        try {
            data = await this.uncached.getAccountData(this.type);
        } catch (ex) {
            if (ex.statusCode != 404) {
                throw ex;
            }
            // Otherwise, this is a "not found" exception, which means that the account doesn't contain any such data.
        }
        this.cache(data);
        this.uncached.on("account_data", this.watch);
    }
    watch = (event: any) => {
        if ("type" in event && event.type === this.type) {
            this.cache(event);
        }
    }
    unregister() {
        this.uncached.removeListener("account_data", this.watch);
    }
}
