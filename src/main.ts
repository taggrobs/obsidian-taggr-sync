/**
 * Taggr Sync — Obsidian plugin for bidirectional sync with Taggr,
 * a decentralized publishing platform on the Internet Computer.
 *
 * Architecture:
 *   Obsidian vault (.md files with frontmatter)
 *       ↕  SyncEngine (pull/push)
 *   TaggrClient (@dfinity/agent)
 *       ↕  Candid / JSON over HTTPS
 *   Taggr canister (6qfxa-ryaaa-aaaai-qbhsq-cai)
 */

import { Plugin, Notice } from "obsidian";
import { TaggrClient } from "./taggr-client";
import { SyncEngine } from "./sync-engine";
import { TaggrSyncSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type TaggrSyncSettings } from "./types";

export default class TaggrSyncPlugin extends Plugin {
    settings!: TaggrSyncSettings;
    client: TaggrClient | null = null;
    private syncEngine: SyncEngine | null = null;
    private syncIntervalId: number | null = null;

    async onload() {
        await this.loadSettings();

        // Initialize client if settings are configured
        if (this.settings.handle) {
            await this.initClient();
        }

        // ─── Commands ──────────────────────────────────────────────

        this.addCommand({
            id: "pull",
            name: "Pull posts from Taggr",
            callback: async () => {
                await this.ensureReady();
                await this.syncEngine?.pull();
            },
        });

        this.addCommand({
            id: "push",
            name: "Push changes to Taggr",
            callback: async () => {
                await this.ensureReady();
                await this.syncEngine?.push();
            },
        });

        this.addCommand({
            id: "sync",
            name: "Sync with Taggr (pull + push)",
            callback: async () => {
                await this.ensureReady();
                await this.syncEngine?.sync();
            },
        });

        this.addCommand({
            id: "new-post",
            name: "Create new Taggr post",
            callback: async () => {
                await this.createNewPostFile();
            },
        });

        // ─── Ribbon icon ───────────────────────────────────────────

        this.addRibbonIcon("refresh-cw", "Sync with Taggr", () => {
            void this.ensureReady().then(() => this.syncEngine?.sync());
        });

        // ─── Settings tab ──────────────────────────────────────────

        this.addSettingTab(new TaggrSyncSettingTab(this.app, this));

        // ─── Auto-sync ─────────────────────────────────────────────

        this.resetSyncInterval();

        console.debug("Taggr Sync plugin loaded.");
    }

    onunload() {
        if (this.syncIntervalId) {
            window.clearInterval(this.syncIntervalId);
        }
        console.debug("Taggr Sync plugin unloaded.");
    }

    // ─── INITIALIZATION ────────────────────────────────────────────────

    async initClient(): Promise<void> {
        try {
            this.client = new TaggrClient(this.settings);
            await this.client.init();
            this.syncEngine = new SyncEngine(
                this.client,
                this.app.vault,
                this.settings,
            );

            // Cache user realms if handle is set and realms not yet cached
            if (this.settings.handle && (!this.settings.cachedRealms || this.settings.cachedRealms.length === 0)) {
                const user = await this.client.fetchUser(this.settings.handle);
                if (user?.realms) {
                    this.settings.cachedRealms = user.realms;
                    await this.saveSettings();
                }
            }
        } catch (error) {
            console.error("Failed to initialize Taggr client:", error);
            new Notice("Taggr Sync: Failed to connect. Check settings.");
        }
    }

    private async ensureReady(): Promise<void> {
        if (!this.client || !this.syncEngine) {
            await this.initClient();
        }
    }

    // ─── AUTO-SYNC ─────────────────────────────────────────────────────

    resetSyncInterval(): void {
        if (this.syncIntervalId) {
            window.clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
        }

        const minutes = this.settings.syncIntervalMinutes;
        if (minutes > 0) {
            this.syncIntervalId = window.setInterval(
                async () => {
                    await this.ensureReady();
                    await this.syncEngine?.sync();
                },
                minutes * 60 * 1000,
            );
            // Register interval for cleanup on plugin unload
            this.registerInterval(this.syncIntervalId);
        }
    }

    // ─── NEW POST ──────────────────────────────────────────────────────

    /**
     * Create a new empty .md file pre-configured for Taggr publishing.
     */
    private async createNewPostFile(): Promise<void> {
        const folder = this.settings.syncFolder;

        // Ensure folder exists
        const existing = this.app.vault.getAbstractFileByPath(folder);
        if (!existing) {
            await this.app.vault.createFolder(folder);
        }

        const timestamp = new Date().toISOString().split("T")[0];
        const fileName = `${folder}/New Post ${timestamp}.md`;

        const realm = this.settings.defaultRealm || "";
        const template = [
            "---",
            `taggr_realm: "${realm}"`,
            "published: false",
            "---",
            "",
            "# Title",
            "",
            "Write your post here in markdown.",
            "",
        ].join("\n");

        const file = await this.app.vault.create(fileName, template);
        await this.app.workspace.getLeaf().openFile(file);
    }

    // ─── SETTINGS ──────────────────────────────────────────────────────

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
