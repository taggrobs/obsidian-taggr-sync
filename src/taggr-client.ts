/**
 * TaggrClient — communicates with the Taggr canister on the Internet Computer.
 *
 * Taggr uses a hybrid encoding:
 *   - Queries: JSON-encoded args sent as raw bytes
 *   - Updates (add_post, edit_post): Candid IDL-encoded args
 *
 * Derived from: TaggrNetwork/Taggr src/frontend/src/api.ts
 */

import { HttpAgent, Identity, polling } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import type { TaggrPost, TaggrUser, PostId, TaggrSyncSettings } from "./types";

export class TaggrClient {
    private agent!: HttpAgent;
    private identity!: Identity;
    private canisterId!: Principal;
    private settings: TaggrSyncSettings;

    constructor(settings: TaggrSyncSettings) {
        this.settings = settings;
    }

    /**
     * Initialize the IC agent with an Ed25519 identity.
     * Supports: seed phrase (hashed like Taggr), raw hex key, or anonymous.
     */
    async init(): Promise<void> {
        if (this.settings.seedPhrase) {
            // Derive key from seed phrase — same algorithm as Taggr frontend
            const seed = await hashSeedPhrase(this.settings.seedPhrase, 15000);
            this.identity = Ed25519KeyIdentity.generate(seed);
        } else if (this.settings.identityKeyHex) {
            const keyBytes = hexToBytes(this.settings.identityKeyHex);
            this.identity = Ed25519KeyIdentity.fromSecretKey(keyBytes);
        } else {
            // Anonymous identity — read-only
            this.identity = Ed25519KeyIdentity.generate();
        }

        this.canisterId = Principal.fromText(this.settings.canisterId);

        this.agent = await HttpAgent.create({
            identity: this.identity,
            host: this.settings.icHost,
        });
    }

    /**
     * Get the principal (public key) of the current identity.
     */
    getPrincipal(): string {
        return this.identity.getPrincipal().toText();
    }

    // ─── QUERIES (read, free, JSON-encoded) ────────────────────────────

    /**
     * Fetch a user's journal posts (top-level posts, not comments).
     * Mirrors: canister_query journal(domain, handle, page, offset)
     */
    async fetchJournal(
        handle: string,
        page: number = 0,
        offset: PostId = 0,
    ): Promise<TaggrPost[] | null> {
        const domain = "taggr.link";
        const args = [domain, handle, page, offset];
        const raw = await this.queryJSON<[TaggrPost, unknown][]>("journal", args);
        if (raw === null) return null; // distinguish error from empty
        return raw.map(([post]) => post);
    }

    /**
     * Fetch a single page with retries. Throws if all retries fail.
     */
    private async fetchJournalPageWithRetry(
        handle: string,
        page: number,
        maxRetries: number = 3,
    ): Promise<TaggrPost[]> {
        let lastError: string = "";
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const posts = await this.fetchJournal(handle, page, 0);
            if (posts !== null) return posts;
            lastError = `Query error on page ${page}`;
            // Exponential backoff: 500ms, 1s, 2s
            if (attempt < maxRetries - 1) {
                await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
            }
        }
        throw new Error(`Failed to fetch journal page ${page} after ${maxRetries} retries: ${lastError}`);
    }

    /**
     * Fetch all journal pages for a user.
     * Retries on errors, logs progress, throws if pagination fails mid-way.
     */
    async fetchAllJournal(
        handle: string,
        onProgress?: (page: number, count: number) => void,
    ): Promise<TaggrPost[]> {
        const allPosts: TaggrPost[] = [];
        let page = 0;
        const pageSize = 30; // Taggr's CONFIG.feed_page_size
        const maxPages = 200; // Safety limit: 6000 posts max

        while (page < maxPages) {
            const posts = await this.fetchJournalPageWithRetry(handle, page);
            if (posts.length === 0) {
                console.log(`[TaggrClient] Journal complete at page ${page} (empty response)`);
                break;
            }
            allPosts.push(...posts);
            onProgress?.(page, allPosts.length);
            console.log(`[TaggrClient] Journal page ${page}: ${posts.length} posts (total: ${allPosts.length})`);
            if (posts.length < pageSize) {
                console.log(`[TaggrClient] Journal complete at page ${page} (partial page)`);
                break;
            }
            page++;
        }

        if (page >= maxPages) {
            console.warn(`[TaggrClient] Hit max pages limit (${maxPages}). User may have more posts.`);
        }

        return allPosts;
    }

    /**
     * Fetch a user's posts INCLUDING comments.
     * Mirrors: canister_query user_posts(domain, handle, page, offset)
     * Returns tuples of [Post, Meta] — we unwrap to just Post.
     */
    async fetchUserPosts(
        handle: string,
        page: number = 0,
        offset: PostId = 0,
    ): Promise<TaggrPost[] | null> {
        const domain = "taggr.link";
        const args = [domain, handle, page, offset];
        const raw = await this.queryJSON<[TaggrPost, unknown][]>("user_posts", args);
        if (raw === null) return null;
        return raw.map(([post]) => post);
    }

    /**
     * Fetch a single user_posts page with retries.
     */
    private async fetchUserPostsPageWithRetry(
        handle: string,
        page: number,
        maxRetries: number = 3,
    ): Promise<TaggrPost[]> {
        let lastError: string = "";
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const posts = await this.fetchUserPosts(handle, page, 0);
            if (posts !== null) return posts;
            lastError = `Query error on page ${page}`;
            if (attempt < maxRetries - 1) {
                await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
            }
        }
        throw new Error(`Failed to fetch user_posts page ${page} after ${maxRetries} retries: ${lastError}`);
    }

    /**
     * Fetch all user_posts pages for a user (posts + comments).
     */
    async fetchAllUserPosts(
        handle: string,
        onProgress?: (page: number, count: number) => void,
    ): Promise<TaggrPost[]> {
        const allPosts: TaggrPost[] = [];
        let page = 0;
        const pageSize = 30;
        const maxPages = 300; // Higher limit since comments add to count

        while (page < maxPages) {
            const posts = await this.fetchUserPostsPageWithRetry(handle, page);
            if (posts.length === 0) {
                console.log(`[TaggrClient] user_posts complete at page ${page} (empty)`);
                break;
            }
            allPosts.push(...posts);
            onProgress?.(page, allPosts.length);
            console.log(`[TaggrClient] user_posts page ${page}: ${posts.length} (total: ${allPosts.length})`);
            if (posts.length < pageSize) {
                console.log(`[TaggrClient] user_posts complete at page ${page} (partial)`);
                break;
            }
            page++;
        }

        if (page >= maxPages) {
            console.warn(`[TaggrClient] Hit max pages limit (${maxPages}).`);
        }

        return allPosts;
    }

    /**
     * Fetch specific posts by their IDs.
     * Mirrors: canister_query posts(ids)
     * Returns Vec<(Post, Meta)> tuples — we unwrap to just Post.
     */
    async fetchPosts(ids: PostId[]): Promise<TaggrPost[]> {
        const raw = await this.queryJSON<[TaggrPost, unknown][]>("posts", ids) || [];
        return raw.map(([post]) => post);
    }

    /**
     * Fetch a single post by ID.
     */
    async fetchPost(id: PostId): Promise<TaggrPost | null> {
        const posts = await this.fetchPosts([id]);
        return posts.length > 0 ? posts[0] : null;
    }

    // ─── USER & COSTS ──────────────────────────────────────────────────

    /**
     * Fetch user profile by handle.
     * Returns cycles balance, realms, etc.
     */
    async fetchUser(handle: string): Promise<TaggrUser | null> {
        return await this.queryJSON<TaggrUser>("user", ["", [handle]]);
    }

    /**
     * Get the cycle cost of tags used in a post body.
     */
    async fetchTagsCost(tags: string[]): Promise<number> {
        if (tags.length === 0) return 0;
        return await this.queryJSON<number>("tags_cost", tags) || 0;
    }

    /**
     * Calculate estimated cost for a post.
     * Formula: post_cost * (body_kb + 1) + tags_cost
     */
    async estimateCost(body: string): Promise<{ textCost: number; tagsCost: number; total: number }> {
        const POST_COST = 2; // from Taggr CONFIG
        const textCost = POST_COST * (Math.floor(body.length / 1024) + 1);
        const tags = (body.match(/#[\w-]+/g) || []).map(t => t.slice(1));
        const tagsCost = await this.fetchTagsCost(tags);
        return { textCost, tagsCost, total: textCost + tagsCost };
    }

    // ─── UPDATES (write, cost cycles, Candid-encoded) ──────────────────

    /**
     * Create a new post on Taggr.
     * Mirrors: add_post(body, blobs, parent, realm, extension)
     * Returns the new post ID on success.
     */
    async createPost(
        body: string,
        realm?: string,
        blobs: [string, Uint8Array][] = [],
    ): Promise<{ ok: PostId } | { err: string }> {
        const arg = IDL.encode(
            [
                IDL.Text,                                          // body
                IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))),  // blobs
                IDL.Opt(IDL.Nat64),                                // parent (none)
                IDL.Opt(IDL.Text),                                 // realm
                IDL.Opt(IDL.Vec(IDL.Nat8)),                        // extension (none)
            ],
            [
                body,
                blobs,
                [],                          // no parent
                realm ? [realm] : [],        // optional realm
                [],                          // no extension
            ],
        );

        const response = await this.callRaw("add_post", arg);
        if (!response) return { err: "No response from canister" };

        const decoded = IDL.decode(
            [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
            response,
        )[0] as { Ok?: bigint; Err?: string };

        if (decoded.Ok !== undefined) {
            return { ok: Number(decoded.Ok) };
        }
        return { err: decoded.Err || "Unknown error" };
    }

    /**
     * Edit an existing post on Taggr.
     * Mirrors: edit_post(id, body, blobs, patch, realm)
     */
    async editPost(
        id: PostId,
        body: string,
        patch: string,
        realm?: string,
        blobs: [string, Uint8Array][] = [],
    ): Promise<{ ok: true } | { err: string }> {
        const arg = IDL.encode(
            [
                IDL.Nat64,                                         // post id
                IDL.Text,                                          // body
                IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))),  // blobs
                IDL.Text,                                          // patch
                IDL.Opt(IDL.Text),                                 // realm
            ],
            [
                id,
                body,
                blobs,
                patch,
                realm ? [realm] : [],
            ],
        );

        const response = await this.callRaw("edit_post", arg);
        if (!response) return { err: "No response from canister" };

        const decoded = IDL.decode(
            [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })],
            response,
        )[0] as { Ok?: null; Err?: string };

        if ("Ok" in decoded) return { ok: true };
        return { err: decoded.Err || "Unknown error" };
    }

    /**
     * Delete a post on Taggr.
     * Mirrors: delete_post(id, versions)
     * WARNING: Irreversible and costs cycles.
     * Note: delete_post uses JSON encoding (not Candid).
     * versions = array of body versions (current + reconstructed from patches)
     * needed for hash verification — at minimum [current_body].
     */
    async deletePost(id: PostId, versions: string[]): Promise<{ ok: true } | { err: string }> {
        try {
            const arg = new TextEncoder().encode(JSON.stringify([id, versions]));
            await this.callRaw("delete_post", arg.buffer as ArrayBuffer);
            return { ok: true };
        } catch (error) {
            return { err: String(error) };
        }
    }

    // ─── TRANSPORT ─────────────────────────────────────────────────────

    /**
     * JSON-encoded query call (Taggr's custom protocol for reads).
     */
    private async queryJSON<T>(method: string, args: unknown): Promise<T | null> {
        try {
            const argBytes = new TextEncoder().encode(JSON.stringify(args));
            const response = await this.agent.query(
                this.canisterId,
                {
                    methodName: method,
                    arg: argBytes.buffer as ArrayBuffer,
                },
            );

            if (response.status !== "replied" || !response.reply) {
                console.error(`Taggr query ${method} failed:`, response);
                return null;
            }

            const text = new TextDecoder().decode(response.reply.arg as ArrayBuffer);
            return JSON.parse(text) as T;
        } catch (error) {
            console.error(`Taggr query ${method} error:`, error);
            return null;
        }
    }

    /**
     * Raw Candid-encoded update call (for writes).
     * Uses callSync to get immediate response via certified variables,
     * falls back to polling if needed.
     */
    private async callRaw(
        method: string,
        arg: ArrayBuffer,
    ): Promise<ArrayBuffer | null> {
        try {
            const { response, requestId } = await this.agent.call(
                this.canisterId,
                { methodName: method, arg, callSync: true },
            );

            if (!response.ok) {
                console.error(`Taggr call ${method} failed: ${response.statusText}`);
                return null;
            }

            // Poll for the response
            const result = await polling.pollForResponse(
                this.agent,
                this.canisterId,
                requestId,
                polling.defaultStrategy(),
            );

            return result?.reply || null;
        } catch (error) {
            console.error(`Taggr call ${method} error:`, error);
            return null;
        }
    }
}

// ─── HELPERS ───────────────────────────────────────────────────────────

function hexToBytes(hex: string): ArrayBuffer {
    const clean = hex.replace(/^0x/, "");
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes.buffer;
}

/**
 * Hash a seed phrase using iterated SHA-256, matching Taggr's frontend.
 * See: TaggrNetwork/Taggr src/frontend/src/common.tsx hash()
 */
async function hashSeedPhrase(phrase: string, iterations: number): Promise<Uint8Array> {
    let hash = new TextEncoder().encode(phrase);
    for (let i = 0; i < iterations; i++) {
        hash = new Uint8Array(await crypto.subtle.digest("SHA-256", hash));
    }
    return hash;
}
