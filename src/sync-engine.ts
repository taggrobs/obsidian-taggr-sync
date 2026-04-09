/**
 * SyncEngine — bidirectional sync between Obsidian vault and Taggr canister.
 *
 * Pull: journal posts → .md files with YAML frontmatter
 * Push: local .md files → add_post / edit_post on canister
 *
 * Frontmatter tracks taggr_id, hash, and patch count to detect changes
 * on both sides and avoid overwrites.
 */

import { Vault, TFile, TFolder, normalizePath, Notice } from "obsidian";
import { TaggrClient } from "./taggr-client";
import type {
    TaggrPost,
    PostId,
    TaggrFrontmatter,
    TaggrSyncSettings,
    SyncAction,
} from "./types";

export class SyncEngine {
    private client: TaggrClient;
    private vault: Vault;
    private settings: TaggrSyncSettings;

    constructor(client: TaggrClient, vault: Vault, settings: TaggrSyncSettings) {
        this.client = client;
        this.vault = vault;
        this.settings = settings;
    }

    // ─── PULL: Taggr → Obsidian ────────────────────────────────────────

    /**
     * Pull all journal posts from Taggr and sync to vault.
     * Returns number of files created/updated.
     */
    async pull(): Promise<{ created: number; updated: number; skipped: number }> {
        const stats = { created: 0, updated: 0, skipped: 0 };

        if (!this.settings.handle) {
            new Notice("Taggr Sync: Set your Taggr handle in settings first.");
            return stats;
        }

        new Notice("Taggr Sync: Pulling posts...");

        let posts: TaggrPost[];
        try {
            const fetcher = this.settings.pullComments
                ? this.client.fetchAllUserPosts.bind(this.client)
                : this.client.fetchAllJournal.bind(this.client);
            posts = await fetcher(
                this.settings.handle,
                (page: number, count: number) => {
                    if (page > 0 && page % 10 === 0) {
                        new Notice(`Taggr Sync: Pulled ${count} posts (page ${page})...`);
                    }
                },
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error("Taggr Sync: Journal fetch failed:", error);
            new Notice(
                `Taggr Sync: Pull FAILED — ${msg}. Some posts may be missing. Check console (Ctrl+Shift+I) for details.`,
                10000,
            );
            return stats;
        }

        if (!posts.length) {
            new Notice("Taggr Sync: No posts found.");
            return stats;
        }

        new Notice(`Taggr Sync: Fetched ${posts.length} posts from Taggr, processing...`);

        // Ensure sync folder exists
        await this.ensureFolder(this.settings.syncFolder);

        // Build index of existing synced files
        const localIndex = await this.buildLocalIndex();

        for (const post of posts) {
            // Skip comments unless pullComments is enabled
            if (post.parent && !this.settings.pullComments) continue;

            // Apply realm filter
            if (this.settings.realmFilter && post.realm !== this.settings.realmFilter) {
                continue;
            }

            const existingPath = localIndex.get(post.id);

            if (existingPath) {
                // File exists — check if Taggr has newer version
                const file = this.vault.getAbstractFileByPath(existingPath);
                if (!(file instanceof TFile)) continue;

                const content = await this.vault.read(file);
                const frontmatter = this.parseFrontmatter(content);

                if (!frontmatter) {
                    stats.skipped++;
                    continue;
                }

                const remoteHash = simpleHash(post.body);
                if (frontmatter.taggr_hash === remoteHash) {
                    stats.skipped++;
                    continue;
                }

                // Remote body changed — check if local also changed
                const localBody = this.extractBody(content);
                const localHash = simpleHash(localBody);

                if (localHash !== frontmatter.taggr_hash) {
                    // Both sides changed — conflict
                    const conflictPath = existingPath.replace(".md", ".conflict.md");
                    await this.vault.create(conflictPath, content);
                    new Notice(`Taggr Sync: Conflict on "${file.basename}" — local backup saved.`);
                }

                // Update local file with remote content
                const newContent = this.buildFileContent(post);
                await this.vault.modify(file, newContent);
                stats.updated++;
            } else {
                // New post — create local file.
                // Comments go in _comments/ folder (flat, no realm subfolders)
                // Top-level posts go in realm subfolders
                const subFolderName = post.parent
                    ? "_comments"
                    : (post.realm || "_general");
                const subFolder = normalizePath(`${this.settings.syncFolder}/${subFolderName}`);
                await this.ensureFolder(subFolder);

                const fileName = this.postToFileName(post);
                const filePath = normalizePath(`${subFolder}/${fileName}`);
                const content = this.buildFileContent(post);
                await this.vault.create(filePath, content);
                stats.created++;
            }
        }

        new Notice(
            `Taggr Sync: Pull complete — ${stats.created} created, ${stats.updated} updated, ${stats.skipped} unchanged.`,
        );
        return stats;
    }

    // ─── PUSH: Obsidian → Taggr ────────────────────────────────────────

    /**
     * Push local changes to Taggr.
     * - Files with taggr_id in frontmatter: edit_post if body changed
     * - Files without taggr_id: add_post (new post)
     * Returns number of posts created/updated.
     */
    async push(): Promise<{ created: number; updated: number; errors: number }> {
        const stats = { created: 0, updated: 0, errors: 0 };

        if (!this.settings.identityKeyHex && !this.settings.seedPhrase) {
            new Notice("Taggr Sync: Set your seed phrase or identity key in settings to push posts.");
            return stats;
        }

        // Fetch user balance before push
        const user = await this.client.fetchUser(this.settings.handle);
        const userCycles = user?.cycles ?? 0;

        new Notice(`Taggr Sync: Pushing changes... (balance: ${userCycles} cycles)`);

        // Build local index for backlink resolution
        const localIndex = await this.buildLocalIndex();

        const folder = this.vault.getAbstractFileByPath(this.settings.syncFolder);
        if (!(folder instanceof TFolder)) {
            new Notice("Taggr Sync: Sync folder not found.");
            return stats;
        }

        // Collect all .md files recursively (including realm subfolders)
        const files: TFile[] = [];
        const collectFiles = (f: TFolder) => {
            for (const child of f.children) {
                if (child instanceof TFolder) {
                    collectFiles(child);
                } else if (child instanceof TFile && child.extension === "md") {
                    files.push(child);
                }
            }
        };
        collectFiles(folder);

        for (const file of files) {
            // Skip conflict files
            if (file.basename.endsWith(".conflict")) continue;

            const content = await this.vault.read(file);
            const frontmatter = this.parseFrontmatter(content);
            // Convert Obsidian backlinks to Taggr links, and bucket URLs back to /blob/xxx
            let body = await this.backlinksToTaggrLinks(this.extractBody(content), localIndex);
            body = body.replace(
                /\(https:\/\/[a-z0-9-]+\.raw\.icp0\.io\/image\?offset=\d+&len=\d+\)/g,
                (match) => {
                    // We need the blob ID — check frontmatter files or just keep as-is
                    // For edits, Taggr preserves existing blobs, so the original /blob/xxx in patches works
                    return match;
                },
            );

            if (!body.trim()) continue;

            // === PUBLISHED: FALSE → never publish, only delete or skip ===
            if (frontmatter?.published === false || (!frontmatter && content.includes("published: false"))) {
                // Already deleted from Taggr → skip entirely
                if (content.includes("taggr_status: \"deleted")) {
                    continue;
                }
                // Has taggr_id → needs to be deleted from Taggr
                if (frontmatter?.taggr_id) {
                    new Notice(
                        `⚠️ UNPUBLISH: Deleting "${file.basename}" (#${frontmatter.taggr_id}) from Taggr. This is irreversible!`,
                        8000,
                    );
                    const result = await this.client.deletePost(frontmatter.taggr_id, [body]);
                    if ("ok" in result) {
                        const lines: string[] = ["---"];
                        lines.push(`taggr_id: ${frontmatter.taggr_id}`);
                        if (frontmatter.taggr_realm) lines.push(`taggr_realm: "${frontmatter.taggr_realm}"`);
                        lines.push("published: false");
                        lines.push(`taggr_status: "deleted from Taggr — was post #${frontmatter.taggr_id}"`);
                        lines.push(`taggr_link: "https://taggr.link/#/post/${frontmatter.taggr_id}"`);
                        lines.push("---");
                        lines.push("");
                        lines.push(body);
                        await this.vault.modify(file, lines.join("\n"));
                        stats.updated++;
                        new Notice(`Taggr Sync: "${file.basename}" deleted from Taggr. File kept locally with reference.`);
                    } else {
                        new Notice(`Taggr Sync: Failed to delete "${file.basename}": ${result.err}`);
                        stats.errors++;
                    }
                }
                // No taggr_id → local draft, skip
                continue;
            }

            // Convert body back to Taggr format for comparison and pushing
            let taggrbody = await this.backlinksToTaggrLinks(body, localIndex);
            taggrbody = taggrbody.replace(
                /\(https:\/\/[a-z0-9-]+\.raw\.icp0\.io\/image\?offset=\d+&len=\d+\)/g,
                (match) => match, // keep as-is for now
            );

            // Check if local body changed since last sync
            const pushHash = simpleHash(taggrbody);
            if (frontmatter?.taggr_id) {
                if (pushHash === frontmatter.taggr_hash) {
                    continue; // No local changes — skip
                }
            }

            // Process local images → Taggr blobs (only if we're actually pushing)
            const { body: processedBody, blobs } = await this.prepareImageBlobs(taggrbody, file.path);

            // Estimate and display cost
            const cost = await this.client.estimateCost(processedBody);
            const blobCostEst = blobs.length > 0
                ? Math.ceil((blobs.reduce((s, [, b]) => s + b.length, 0) * 20) / MAX_BLOB_SIZE)
                : 0;
            if (cost.total + blobCostEst > 0) {
                new Notice(
                    `"${file.basename}" — cost: ${cost.total + blobCostEst} cycles` +
                    (blobs.length > 0 ? ` (${blobs.length} image${blobs.length > 1 ? "s" : ""})` : ""),
                );
            }

            if (frontmatter?.taggr_id) {

                // Generate a simple patch description
                const patch = `Updated from Obsidian at ${new Date().toISOString()}`;
                const result = await this.client.editPost(
                    frontmatter.taggr_id,
                    processedBody,
                    patch,
                    frontmatter.taggr_realm,
                    blobs,
                );

                if ("ok" in result) {
                    // Update frontmatter with Taggr-format hash
                    const updatedFm: Partial<TaggrFrontmatter> = {
                        ...frontmatter,
                        taggr_hash: pushHash,
                        taggr_patches: (frontmatter.taggr_patches || 0) + 1,
                    };
                    const newContent = this.rebuildFileContent(updatedFm as TaggrFrontmatter, body);
                    await this.vault.modify(file, newContent);
                    stats.updated++;
                } else {
                    console.error(`Failed to edit post ${frontmatter.taggr_id}:`, result.err);
                    new Notice(`Taggr Sync: Failed to update "${file.basename}": ${result.err}`);
                    stats.errors++;
                }
            } else {
                // New post — publish to Taggr
                // Realm from: frontmatter > subfolder > default setting
                const realm = this.extractRealmFromFrontmatter(content)
                    || this.realmFromPath(file.path)
                    || this.settings.defaultRealm
                    || undefined;
                const result = await this.client.createPost(processedBody, realm, blobs);

                if ("ok" in result) {
                    // Write back frontmatter with new taggr_id
                    const newFm: TaggrFrontmatter = {
                        taggr_id: result.ok,
                        taggr_user: 0, // will be filled on next pull
                        taggr_realm: realm,
                        taggr_timestamp: Date.now() * 1_000_000, // nanoseconds
                        taggr_hash: simpleHash(processedBody),
                        taggr_patches: 0,
                        published: true,
                    };
                    const newContent = this.rebuildFileContent(newFm, processedBody);
                    await this.vault.modify(file, newContent);
                    stats.created++;
                } else {
                    console.error(`Failed to create post from "${file.basename}":`, result.err);
                    new Notice(`Taggr Sync: Failed to publish "${file.basename}": ${result.err}`);
                    stats.errors++;
                }
            }
        }

        new Notice(
            `Taggr Sync: Push complete — ${stats.created} published, ${stats.updated} updated, ${stats.errors} errors.`,
        );
        return stats;
    }

    // ─── FULL SYNC ─────────────────────────────────────────────────────

    async sync(): Promise<void> {
        const dir = this.settings.syncDirection;
        if (dir === "pull" || dir === "both") {
            await this.pull();
        }
        if (dir === "push" || dir === "both") {
            await this.push();
        }
    }

    // ─── FILE / FRONTMATTER HELPERS ────────────────────────────────────

    /**
     * Build a complete .md file with YAML frontmatter from a Taggr post.
     * Converts blob references to full URLs.
     */
    private buildFileContent(post: TaggrPost): string {
        const tags = this.extractTagsFromBody(post.body);
        // Hash the RAW body from Taggr BEFORE any conversions
        const rawBodyHash = simpleHash(post.body);
        // Replace /blob/xxx with real bucket image URLs
        post.body = post.body.replace(
            /\(\/blob\/([a-f0-9]+)\)/g,
            (_match, blobId) => {
                // Find bucket canister and offset from post.files
                const fileEntry = Object.entries(post.files || {}).find(
                    ([key]) => key.startsWith(blobId + "@"),
                );
                if (fileEntry) {
                    const bucketId = fileEntry[0].split("@")[1];
                    const [offset, len] = fileEntry[1];
                    return `(https://${bucketId}.raw.icp0.io/image?offset=${offset}&len=${len})`;
                }
                // Fallback: use main canister URL
                return `(https://${this.settings.canisterId}.raw.icp0.io/blob/${blobId})`;
            },
        );
        // Convert Taggr post links to Obsidian backlinks
        post.body = this.taggrLinksToBacklinks(post.body);

        // Build reactions summary
        const reactionParts: string[] = [];
        for (const [id, users] of Object.entries(post.reactions || {})) {
            const name = REACTION_EMOJI[Number(id)] || `r${id}`;
            reactionParts.push(`${name}:${(users as number[]).length}`);
        }

        const fm: TaggrFrontmatter = {
            taggr_id: post.id,
            taggr_user: post.user,
            taggr_realm: post.realm,
            taggr_timestamp: post.timestamp,
            taggr_hash: rawBodyHash,
            taggr_patches: post.patches?.length || 0,
            tags: tags.length > 0 ? tags : undefined,
            published: true,
            taggr_cost: this.calculatePostCost(post),
            taggr_reactions: reactionParts.length > 0 ? reactionParts.join(", ") : undefined,
            taggr_comments: post.children?.length || 0,
            taggr_tips: post.tips?.reduce((sum, [, amount]) => sum + amount, 0) || 0,
            taggr_parent_id: post.parent,
            taggr_parent_link: post.parent ? `https://taggr.link/#/post/${post.parent}` : undefined,
        };

        return this.rebuildFileContent(fm, post.body);
    }

    /**
     * Rebuild file content from frontmatter + body.
     */
    private rebuildFileContent(fm: TaggrFrontmatter, body: string): string {
        const lines: string[] = ["---"];
        lines.push(`taggr_id: ${fm.taggr_id}`);
        lines.push(`taggr_user: ${fm.taggr_user}`);
        if (fm.taggr_realm) lines.push(`taggr_realm: "${fm.taggr_realm}"`);
        lines.push(`taggr_timestamp: ${fm.taggr_timestamp}`);
        if (fm.taggr_hash) lines.push(`taggr_hash: "${fm.taggr_hash}"`);
        lines.push(`taggr_patches: ${fm.taggr_patches}`);
        if (fm.taggr_cost) lines.push(`taggr_cost: ${fm.taggr_cost}`);
        if (fm.tags && fm.tags.length > 0) {
            lines.push(`tags: [${fm.tags.map((t) => `"${t}"`).join(", ")}]`);
        }
        if (fm.taggr_reactions) lines.push(`taggr_reactions: "${fm.taggr_reactions}"`);
        if (fm.taggr_comments) lines.push(`taggr_comments: ${fm.taggr_comments}`);
        if (fm.taggr_tips) lines.push(`taggr_tips: ${fm.taggr_tips}`);
        if (fm.taggr_parent_id) {
            lines.push(`taggr_parent_id: ${fm.taggr_parent_id}`);
            lines.push(`taggr_parent_link: "${fm.taggr_parent_link}"`);
        }
        lines.push(`published: ${fm.published}`);
        if (fm.published && fm.taggr_id) {
            lines.push(`taggr_status: "live on Taggr — uncheck published to delete from Taggr"`);
            lines.push(`taggr_link: "https://taggr.link/#/post/${fm.taggr_id}"`);
        } else if (!fm.published && fm.taggr_id) {
            lines.push(`taggr_status: "deleted from Taggr"`);
            lines.push(`taggr_link: "https://taggr.link/#/post/${fm.taggr_id}"`);
        } else {
            lines.push(`taggr_status: "local draft — check published to post to Taggr"`);
        }
        lines.push("---");
        lines.push("");
        lines.push(body);
        return lines.join("\n");
    }

    /**
     * Parse YAML frontmatter from a file's content.
     */
    parseFrontmatter(content: string): TaggrFrontmatter | null {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const yaml = match[1];
        const fm: Partial<TaggrFrontmatter> = {};

        for (const line of yaml.split("\n")) {
            const [key, ...rest] = line.split(":");
            const value = rest.join(":").trim();
            if (!key || !value) continue;

            const k = key.trim();
            switch (k) {
                case "taggr_id":
                    fm.taggr_id = parseInt(value);
                    break;
                case "taggr_user":
                    fm.taggr_user = parseInt(value);
                    break;
                case "taggr_realm":
                    fm.taggr_realm = value.replace(/"/g, "");
                    break;
                case "taggr_timestamp":
                    fm.taggr_timestamp = parseInt(value);
                    break;
                case "taggr_hash":
                    fm.taggr_hash = value.replace(/"/g, "");
                    break;
                case "taggr_patches":
                    fm.taggr_patches = parseInt(value);
                    break;
                case "taggr_parent_id":
                    fm.taggr_parent_id = parseInt(value);
                    break;
                case "published":
                    fm.published = value === "true";
                    break;
                case "tags":
                    fm.tags = value
                        .replace(/[\[\]"]/g, "")
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean);
                    break;
            }
        }

        if (fm.taggr_id === undefined) return null;
        return fm as TaggrFrontmatter;
    }

    /**
     * Extract body content (everything after frontmatter).
     */
    extractBody(content: string): string {
        const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
        return match ? match[1].trim() : content.trim();
    }

    /**
     * Extract realm from frontmatter string (for new posts).
     */
    private extractRealmFromFrontmatter(content: string): string | undefined {
        const fm = this.parseFrontmatter(content);
        return fm?.taggr_realm;
    }

    /**
     * Deduce realm from file path.
     * e.g. "taggr/CRYPTO/my-post.md" → "CRYPTO"
     * Files directly in sync folder (no subfolder) → undefined
     * Files in "_general" subfolder → undefined
     */
    private realmFromPath(filePath: string): string | undefined {
        const syncFolder = this.settings.syncFolder;
        const relative = filePath.startsWith(syncFolder + "/")
            ? filePath.slice(syncFolder.length + 1)
            : filePath;
        const parts = relative.split("/");
        if (parts.length < 2) return undefined; // file directly in sync folder
        const folder = parts[0];
        // Special folders don't map to a realm
        if (folder === "_general" || folder === "_comments") return undefined;
        return folder;
    }

    /**
     * Extract hashtags from post body.
     */
    private extractTagsFromBody(body: string): string[] {
        const matches = body.match(/#[\w-]+/g);
        return matches ? [...new Set(matches.map((t) => t.slice(1)))] : [];
    }

    /**
     * Generate a file name from a post.
     * Uses the first line as title (stripped of #), or post ID.
     */
    private postToFileName(post: TaggrPost): string {
        const firstLine = post.body.split("\n")[0] || "";
        let title = firstLine
            .replace(/^#+\s*/, "")  // strip markdown heading
            .replace(/[\\/:*?"<>|#^[\]]/g, "")  // strip illegal chars
            .trim()
            .slice(0, 80);

        if (!title) title = `taggr-${post.id}`;
        return `${title}.md`;
    }

    /**
     * Build index: taggr_id → file path, for all synced files (recursive).
     */
    private async buildLocalIndex(): Promise<Map<PostId, string>> {
        const index = new Map<PostId, string>();
        const folder = this.vault.getAbstractFileByPath(this.settings.syncFolder);
        if (!(folder instanceof TFolder)) return index;

        const scanFolder = async (f: TFolder) => {
            for (const child of f.children) {
                if (child instanceof TFolder) {
                    await scanFolder(child);
                } else if (child instanceof TFile && child.extension === "md") {
                    if (child.basename.endsWith(".conflict")) continue;
                    const content = await this.vault.read(child);
                    const fm = this.parseFrontmatter(content);
                    if (fm?.taggr_id) {
                        index.set(fm.taggr_id, child.path);
                    }
                }
            }
        };

        await scanFolder(folder);
        return index;
    }

    // ─── IMAGE UPLOAD ──────────────────────────────────────────────────

    /**
     * Scan body for local image references, read & resize them,
     * replace with Taggr blob format, return blobs array.
     *
     * Detects:
     *   ![alt](./path/to/image.png)       — relative path
     *   ![alt](path/to/image.png)         — vault path
     *   ![[image.png]]                    — Obsidian embed
     */
    private async prepareImageBlobs(
        body: string,
        filePath: string,
    ): Promise<{ body: string; blobs: [string, Uint8Array][] }> {
        const blobs: [string, Uint8Array][] = [];
        const folder = filePath.substring(0, filePath.lastIndexOf("/"));

        // Match ![alt](local-path) — skip URLs (http/https) and existing /blob/ refs
        const mdImageRegex = /!\[([^\]]*)\]\((?!https?:\/\/)(?!\/blob\/)([^)]+)\)/g;
        // Match ![[filename]] — Obsidian embed with brackets
        const obsidianEmbedRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp))\]\]/gi;
        // Match !filename.ext — Obsidian embed without brackets (stripped by some render modes)
        const bareEmbedRegex = /^!([\w\s._-]+\.(png|jpg|jpeg|gif|webp))$/gim;

        let newBody = body;

        // Process standard markdown images
        for (const match of body.matchAll(mdImageRegex)) {
            const [fullMatch, alt, imagePath] = match;
            const resolvedPath = imagePath.startsWith("./")
                ? `${folder}/${imagePath.slice(2)}`
                : imagePath.startsWith("/")
                    ? imagePath.slice(1)
                    : `${folder}/${imagePath}`;

            const imageFile = this.vault.getAbstractFileByPath(resolvedPath);
            if (!(imageFile instanceof TFile)) continue;

            try {
                const data = await this.vault.readBinary(imageFile);
                const { bytes, width, height } = await resizeImage(data);
                const blobId = await generateBlobId(bytes);
                const sizeKb = Math.round(bytes.length / 1024);

                blobs.push([blobId, bytes]);
                newBody = newBody.replace(
                    fullMatch,
                    `![${width}x${height}, ${sizeKb}kb](/blob/${blobId})`,
                );
            } catch (e) {
                console.error(`Failed to process image ${imagePath}:`, e);
            }
        }

        // Process Obsidian embeds ![[image.png]]
        for (const match of body.matchAll(obsidianEmbedRegex)) {
            const [fullMatch, fileName] = match;

            // Find file in vault
            const imageFile = this.vault.getFiles().find(
                f => f.name === fileName || f.path.endsWith(`/${fileName}`),
            );
            if (!imageFile) continue;

            try {
                const data = await this.vault.readBinary(imageFile);
                const { bytes, width, height } = await resizeImage(data);
                const blobId = await generateBlobId(bytes);
                const sizeKb = Math.round(bytes.length / 1024);

                blobs.push([blobId, bytes]);
                newBody = newBody.replace(
                    fullMatch,
                    `![${width}x${height}, ${sizeKb}kb](/blob/${blobId})`,
                );
            } catch (e) {
                console.error(`Failed to process embed ${fileName}:`, e);
            }
        }

        // Process bare embeds: !filename.ext (without brackets)
        for (const match of newBody.matchAll(bareEmbedRegex)) {
            const [fullMatch, fileName] = match;

            const imageFile = this.vault.getFiles().find(
                f => f.name === fileName || f.path.endsWith(`/${fileName}`),
            );
            if (!imageFile) continue;

            try {
                const data = await this.vault.readBinary(imageFile);
                const { bytes, width, height } = await resizeImage(data);
                const blobId = await generateBlobId(bytes);
                const sizeKb = Math.round(bytes.length / 1024);

                blobs.push([blobId, bytes]);
                newBody = newBody.replace(
                    fullMatch,
                    `![${width}x${height}, ${sizeKb}kb](/blob/${blobId})`,
                );
            } catch (e) {
                console.error(`Failed to process bare embed ${fileName}:`, e);
            }
        }

        return { body: newBody, blobs };
    }

    // ─── COST CALCULATION ──────────────────────────────────────────────

    /**
     * Calculate total accumulated cost of a post across all edits.
     * Replays each edit step to compute what was charged at each point.
     *
     * From: TaggrNetwork/Taggr src/backend/env/post.rs costs()
     * Each edit charges: post_cost * ((body_len + accumulated_patches_len) / 1024 + 1) + blob_cost
     * Blob cost is charged only on initial creation (blobs are attached at post time).
     */
    private calculatePostCost(post: TaggrPost): number {
        const POST_COST = 2;
        const BLOB_COST = 20;
        const MAX_BLOB_SIZE = 460800; // 450KB

        const patches = post.patches || [];
        const bodyLen = post.body.length;

        // Blob cost (charged once on creation)
        const blobBytes = Object.values(post.files || {}).reduce(
            (sum, [_offset, len]) => sum + len, 0,
        );
        const blobCost = blobBytes > 0
            ? Math.ceil((blobBytes * BLOB_COST) / MAX_BLOB_SIZE)
            : 0;

        // Initial post cost
        let totalCost = POST_COST * (Math.floor(bodyLen / 1024) + 1) + blobCost;

        // Each edit is charged with accumulated patches
        let accumulatedPatchLen = 0;
        for (const [_ts, diff] of patches) {
            accumulatedPatchLen += diff.length;
            const editCost = POST_COST * (Math.floor((bodyLen + accumulatedPatchLen) / 1024) + 1);
            totalCost += editCost;
        }

        return totalCost;
    }

    // ─── BACKLINK CONVERSION ──────────────────────────────────────────

    /**
     * Convert Taggr internal links to Obsidian backlinks (for Pull).
     * [text](#/post/ID) → [[Post Title]] if we have that post locally
     * @username → [[@username]] as Obsidian link
     */
    private taggrLinksToBacklinks(body: string): string {
        // Convert [text](#/post/ID) → [[text]]
        // We use the link text as the backlink target (it's usually the post title)
        body = body.replace(
            /\[([^\]]+)\]\(#\/post\/(\d+)\)/g,
            (_match, text, _postId) => `[[${text}]]`,
        );

        // Convert @username mentions to backlinks (standalone, not in emails)
        body = body.replace(
            /(?<![a-zA-Z0-9._%+-])@([a-zA-Z0-9_-]+)/g,
            (_match, username) => `[[@${username}]]`,
        );

        return body;
    }

    /**
     * Convert Obsidian backlinks to Taggr internal links (for Push).
     * [[Post Title]] → [Post Title](#/post/ID) if post is synced
     * [[@username]] → @username
     */
    private async backlinksToTaggrLinks(body: string, localIndex: Map<PostId, string>): Promise<string> {
        // Build reverse index: filename → taggr_id
        const nameToId = new Map<string, PostId>();
        for (const [id, path] of localIndex) {
            const basename = path.split("/").pop()?.replace(".md", "") || "";
            nameToId.set(basename, id);
        }

        // Convert [[Post Title]] → [Post Title](#/post/ID)
        body = body.replace(
            /\[\[([^\]]+)\]\]/g,
            (_match, linkText) => {
                // Check if it's a @username backlink
                if (linkText.startsWith("@")) {
                    return linkText; // Just @username, no brackets
                }
                // Check if we have a synced post with this title
                const postId = nameToId.get(linkText);
                if (postId !== undefined) {
                    return `[${linkText}](#/post/${postId})`;
                }
                // Not a synced post — keep as plain text
                return linkText;
            },
        );

        return body;
    }

    /**
     * Ensure a folder exists in the vault.
     */
    private async ensureFolder(path: string): Promise<void> {
        const existing = this.vault.getAbstractFileByPath(path);
        if (!existing) {
            await this.vault.createFolder(path);
        }
    }
}

// ─── IMAGE PROCESSING ─────────────────────────────────────────────────

const MAX_BLOB_SIZE = 460800; // 450KB — Taggr's CONFIG.max_blob_size_bytes

/**
 * Generate blob ID from image bytes — first 4 bytes of SHA-256 as hex.
 * Matches Taggr frontend: hash() in form.tsx
 */
async function generateBlobId(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer).slice(0, 4))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Resize an image to fit within MAX_BLOB_SIZE using canvas.
 * Returns JPEG bytes. Uses binary search on quality.
 */
async function resizeImage(data: ArrayBuffer): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const blob = new Blob([data]);
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;

    // Try original size first
    if (data.byteLength <= MAX_BLOB_SIZE) {
        bitmap.close();
        return { bytes: new Uint8Array(data), width, height };
    }

    // Binary search on JPEG quality
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    let low = 10;
    let high = 95;
    let bestBlob: Blob | null = null;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const result = await canvas.convertToBlob({ type: "image/jpeg", quality: mid / 100 });
        if (result.size <= MAX_BLOB_SIZE) {
            bestBlob = result;
            low = mid + 1; // Try higher quality
        } else {
            high = mid - 1; // Lower quality
        }
    }

    if (!bestBlob) {
        // Still too big — scale down dimensions
        const scale = Math.sqrt(MAX_BLOB_SIZE / data.byteLength) * 0.9;
        const newW = Math.floor(width * scale);
        const newH = Math.floor(height * scale);
        const smallCanvas = new OffscreenCanvas(newW, newH);
        const smallCtx = smallCanvas.getContext("2d")!;
        const bitmap2 = await createImageBitmap(new Blob([data]));
        smallCtx.drawImage(bitmap2, 0, 0, newW, newH);
        bitmap2.close();
        bestBlob = await smallCanvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        return {
            bytes: new Uint8Array(await bestBlob.arrayBuffer()),
            width: newW,
            height: newH,
        };
    }

    return {
        bytes: new Uint8Array(await bestBlob.arrayBuffer()),
        width,
        height,
    };
}

// ─── REACTIONS MAP ────────────────────────────────────────────────────

const REACTION_EMOJI: { [id: number]: string } = {
    1: "downvote",
    10: "heart",
    11: "thumbsup",
    12: "sad",
    50: "fire",
    51: "laugh",
    52: "hundred",
    53: "rocket",
    100: "star",
    101: "pirate",
};

// ─── UTILS ─────────────────────────────────────────────────────────────

/**
 * Simple string hash for change detection.
 * Not cryptographic — just for comparing body content.
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
