/**
 * Settings tab for Taggr Sync plugin.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type TaggrSyncPlugin from "./main";

export class TaggrSyncSettingTab extends PluginSettingTab {
    plugin: TaggrSyncPlugin;

    constructor(app: App, plugin: TaggrSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ─── Connection ────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Connection" });

        new Setting(containerEl)
            .setName("Taggr Handle")
            .setDesc("Your username on Taggr (for pulling your journal).")
            .addText((text) =>
                text
                    .setPlaceholder("your_handle")
                    .setValue(this.plugin.settings.handle)
                    .onChange(async (value) => {
                        this.plugin.settings.handle = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Seed Phrase")
            .setDesc(
                "Your Taggr seed phrase — the same one you use to log in on taggr.link. " +
                "The key is derived locally (never sent anywhere). " +
                "Leave empty for read-only (pull only).",
            )
            .addText((text) =>
                text
                    .setPlaceholder("Enter seed phrase...")
                    .setValue(this.plugin.settings.seedPhrase)
                    .onChange(async (value) => {
                        this.plugin.settings.seedPhrase = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Identity Key (hex)")
            .setDesc(
                "Alternative: raw Ed25519 private key (hex). " +
                "Use this OR seed phrase, not both. Seed phrase takes priority.",
            )
            .addText((text) =>
                text
                    .setPlaceholder("0x...")
                    .setValue(this.plugin.settings.identityKeyHex)
                    .onChange(async (value) => {
                        this.plugin.settings.identityKeyHex = value;
                        await this.plugin.saveSettings();
                    }),
            );

        if (this.plugin.client) {
            const principalEl = containerEl.createEl("p", {
                cls: "setting-item-description",
            });
            principalEl.setText(
                `Current principal: ${this.plugin.client.getPrincipal()}`,
            );
        }

        // ─── Sync ──────────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Sync" });

        new Setting(containerEl)
            .setName("Sync Folder")
            .setDesc("Folder in vault where Taggr posts are synced.")
            .addText((text) =>
                text
                    .setPlaceholder("taggr")
                    .setValue(this.plugin.settings.syncFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.syncFolder = value || "taggr";
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Sync Direction")
            .setDesc("Pull (read from Taggr), Push (write to Taggr), or Both.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("pull", "Pull only (read)")
                    .addOption("push", "Push only (write)")
                    .addOption("both", "Bidirectional")
                    .setValue(this.plugin.settings.syncDirection)
                    .onChange(async (value: "pull" | "push" | "both") => {
                        this.plugin.settings.syncDirection = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Auto-sync Interval (minutes)")
            .setDesc("0 = manual sync only. Recommended: 5-15 minutes.")
            .addText((text) =>
                text
                    .setPlaceholder("0")
                    .setValue(String(this.plugin.settings.syncIntervalMinutes))
                    .onChange(async (value) => {
                        this.plugin.settings.syncIntervalMinutes =
                            parseInt(value) || 0;
                        await this.plugin.saveSettings();
                        this.plugin.resetSyncInterval();
                    }),
            );

        new Setting(containerEl)
            .setName("Realm Filter")
            .setDesc("Only pull posts from this realm. Empty = all realms.")
            .addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.realmFilter)
                    .onChange(async (value) => {
                        this.plugin.settings.realmFilter = value;
                        await this.plugin.saveSettings();
                    }),
            );

        const realms = Array.isArray(this.plugin.settings.cachedRealms) ? this.plugin.settings.cachedRealms : [];
        new Setting(containerEl)
            .setName("Default Realm for New Posts")
            .setDesc(
                realms.length > 0
                    ? `Post to this realm by default. You have ${realms.length} realms.`
                    : "No realms loaded yet. Use Test Connection to fetch your realms.",
            )
            .addDropdown((dropdown) => {
                dropdown.addOption("", "(no realm)");
                for (const realm of realms) {
                    dropdown.addOption(realm, realm);
                }
                dropdown
                    .setValue(this.plugin.settings.defaultRealm)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultRealm = value;
                        await this.plugin.saveSettings();
                    });
            });

        // ─── Advanced ──────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Advanced" });

        new Setting(containerEl)
            .setName("Canister ID")
            .setDesc("Taggr canister ID. Don't change unless you know what you're doing.")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.canisterId)
                    .onChange(async (value) => {
                        this.plugin.settings.canisterId = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("IC Host")
            .setDesc("Internet Computer host URL.")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.icHost)
                    .onChange(async (value) => {
                        this.plugin.settings.icHost = value;
                        await this.plugin.saveSettings();
                    }),
            );

        // ─── Actions ───────────────────────────────────────────────

        containerEl.createEl("h2", { text: "Actions" });

        new Setting(containerEl)
            .setName("Generate Identity")
            .setDesc("Generate a new Ed25519 keypair. Copy the principal and add it as a controller on Taggr.")
            .addButton((button) =>
                button.setButtonText("Generate").onClick(async () => {
                    const { Ed25519KeyIdentity } = await import(
                        "@dfinity/identity"
                    );
                    const identity = Ed25519KeyIdentity.generate();
                    const keyHex = Array.from(
                        new Uint8Array(identity.getKeyPair().secretKey),
                    ).map(b => b.toString(16).padStart(2, "0")).join("");
                    const principal = identity.getPrincipal().toText();

                    this.plugin.settings.identityKeyHex = keyHex;
                    await this.plugin.saveSettings();

                    // Refresh display
                    this.display();

                    // Copy principal to clipboard
                    await navigator.clipboard.writeText(principal);
                    new (await import("obsidian")).Notice(
                        `Key generated! Principal copied to clipboard:\n${principal}\n\nAdd this as a controller on your Taggr account.`,
                        10000,
                    );
                }),
            );

        new Setting(containerEl)
            .setName("Test Connection")
            .setDesc("Verify the connection to Taggr canister.")
            .addButton((button) =>
                button.setButtonText("Test").onClick(async () => {
                    await this.plugin.initClient();
                    const { Notice } = await import("obsidian");

                    // Fetch user profile (balance + realms)
                    const user = await this.plugin.client?.fetchUser(
                        this.plugin.settings.handle,
                    );

                    if (user) {
                        // Cache realms
                        this.plugin.settings.cachedRealms = user.realms || [];
                        await this.plugin.saveSettings();

                        new Notice(
                            `Connected! @${user.name}\n` +
                            `Balance: ${user.cycles} cycles\n` +
                            `Posts: ${user.num_posts}\n` +
                            `Realms: ${user.realms?.length || 0}`,
                            8000,
                        );

                        // Refresh display to show realm dropdown
                        this.display();
                    } else {
                        new Notice(
                            `Could not find user @${this.plugin.settings.handle}. Check the handle.`,
                        );
                    }
                }),
            );
    }
}
