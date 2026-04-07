/**
 * Types mirroring Taggr's canister data structures.
 * Derived from: TaggrNetwork/Taggr src/frontend/src/types.tsx
 */

export type PostId = number;
export type UserId = number;
export type RealmId = string;

export type TaggrPost = {
    id: PostId;
    parent?: PostId;
    children: PostId[];
    user: UserId;
    body: string;        // markdown content
    reactions: { [id: number]: UserId[] };
    files: { [id: string]: [number, number] };
    patches: [number, string][];  // version history: [timestamp, diff]
    tips: [UserId, number][];
    hashes: string[];
    realm?: RealmId;
    timestamp: number;
    tree_size: number;
    tree_update: number;
    tags?: string[];
    encrypted: boolean;
    extension: unknown;
    external_tips: unknown;
    heat: number;
    hidden_for: unknown;
    reposts: PostId[];
    watchers: UserId[];
};

/**
 * Meta returned alongside each post from with_meta().
 * API returns tuples: [Post, Meta].
 */
export type TaggrMeta = {
    author_name: string;
    author_filters: { age_days: number; balance: number; num_followers: number; safe: boolean };
    nsfw: boolean;
    viewer_blocked: boolean;
    max_downvotes_reached: boolean;
};

/**
 * Subset of Taggr user profile relevant to the plugin.
 */
export type TaggrUser = {
    id: UserId;
    name: string;
    cycles: number;
    balance: number;
    realms: RealmId[];
    num_posts: number;
};

/**
 * Frontmatter stored in each synced .md file to track Taggr state.
 */
export type TaggrFrontmatter = {
    taggr_id: PostId;
    taggr_user: UserId;
    taggr_realm?: string;
    taggr_timestamp: number;
    taggr_hash?: string;       // hash of body at last sync
    taggr_patches: number;     // number of patches at last sync
    tags?: string[];
    published: boolean;
    taggr_cost?: number;
    taggr_reactions?: string;      // e.g. "fire:4, star:1, pirate:2"
    taggr_comments?: number;       // number of direct comments
    taggr_tips?: number;           // total tips received
};

/**
 * Sync direction for a file.
 */
export type SyncAction =
    | { type: "pull_new"; post: TaggrPost }
    | { type: "pull_update"; post: TaggrPost; localPath: string }
    | { type: "push_new"; localPath: string; body: string; realm?: string }
    | { type: "push_update"; localPath: string; body: string; postId: PostId; realm?: string }
    | { type: "conflict"; post: TaggrPost; localPath: string };

/**
 * Plugin settings persisted in Obsidian data.json
 */
export interface TaggrSyncSettings {
    /** Taggr canister ID (mainnet default) */
    canisterId: string;
    /** IC host URL */
    icHost: string;
    /** Taggr username/handle to sync journal from */
    handle: string;
    /** Folder in vault where synced posts live */
    syncFolder: string;
    /** Auto-sync interval in minutes (0 = manual only) */
    syncIntervalMinutes: number;
    /** Ed25519 private key (hex) for signing IC calls */
    identityKeyHex: string;
    /** Seed phrase (same as Taggr login) — derives Ed25519 key via iterated SHA-256 */
    seedPhrase: string;
    /** Only sync posts from this realm (empty = all) */
    realmFilter: string;
    /** Default realm for new posts (empty = no realm) */
    defaultRealm: string;
    /** Cached list of user's realms (populated on connection) */
    cachedRealms: string[];
    /** Sync direction: pull-only, push-only, or bidirectional */
    syncDirection: "pull" | "push" | "both";
}

export const DEFAULT_SETTINGS: TaggrSyncSettings = {
    canisterId: "6qfxa-ryaaa-aaaai-qbhsq-cai",
    icHost: "https://ic0.app",
    handle: "",
    syncFolder: "taggr",
    syncIntervalMinutes: 0,
    identityKeyHex: "",
    seedPhrase: "",
    realmFilter: "",
    defaultRealm: "",
    cachedRealms: [],
    syncDirection: "both",
};
