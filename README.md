# Taggr Sync for Obsidian

Bidirectional sync between your Obsidian vault and [Taggr](https://taggr.link) — a decentralized publishing platform on the Internet Computer.

Write and edit posts in Obsidian's markdown editor, sync them to Taggr, and pull posts back. Works on desktop and mobile.

## Features

- **Pull** posts from your Taggr journal into your vault as `.md` files
- **Push** new or edited posts from Obsidian to Taggr
- **Realm subfolders** — posts auto-organized by realm (e.g., `taggr/CRYPTO/`, `taggr/AI/`)
- **Image sync** — upload images from Obsidian to Taggr, and pull Taggr images inline
- **Bidirectional backlinks** — `[[links]]` in Obsidian become `[links](#/post/ID)` on Taggr and vice versa
- **Cost display** — total cycle cost per post in frontmatter (text + images + edits)
- **Publish / unpublish** — check to publish, uncheck to delete from Taggr (file stays local)
- **Status + link** — each post shows its Taggr status and direct link in frontmatter
- **Seed phrase login** — same credentials as taggr.link, derived locally, never transmitted
- **Controller key** — alternative auth for Internet Identity users
- **Cross-platform** — works on desktop, iOS, and Android

## Architecture

```
Obsidian vault                           Taggr canister (IC)
+---------------------+                  +------------------+
| /taggr/             |                  | 6qfxa-ryaaa-...  |
|   CRYPTO/           |  <-- pull ----   |   post #4527     |
|     analysis.md     |  --- push --->   |   post #4528     |
|   _general/         |                  |                  |
|     hello.md        |                  |                  |
+---------------------+                  +------------------+
         |                                        |
    YAML frontmatter                        Candid / JSON
    tracks taggr_id,                       over HTTPS to
    hash, patches, cost                    ic0.app
```

## Quick start: from zero to first sync

### Step 1: Create a Taggr account

1. Go to [taggr.link](https://taggr.link)
2. Click **Connect** (top right)
3. Choose **Seed Phrase** as your login method
4. Enter a strong seed phrase — this is your password, save it securely. A good seed phrase is a BIP-39 mnemonic (12+ random words) or a strong passphrase (16+ characters with mixed case, numbers, symbols)
5. Confirm the seed phrase
6. Choose a **username** (this is your handle)
7. Done — you now have a Taggr account with some starting credits

**Important:** Remember your seed phrase and username. You'll need both for the plugin.

### Step 2: Install the plugin

**Option A: Download release (recommended)**

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/taggrobs/obsidian-taggr-sync/releases/latest)
2. In your Obsidian vault folder, create `.obsidian/plugins/taggr-sync/`
3. Put both files in that folder
4. Open Obsidian → Settings → Community plugins
5. Disable **Restricted Mode** if prompted
6. Enable **Taggr Sync**

**Option B: Build from source**

```bash
git clone https://github.com/taggrobs/obsidian-taggr-sync.git
cd obsidian-taggr-sync
npm install
npm run build
```
Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/taggr-sync/` folder, then enable in Obsidian.

### Step 3: Configure the plugin

1. In Obsidian, go to Settings → **Taggr Sync**
2. Enter your **Taggr Handle** (username)
3. Enter your **Seed Phrase** (the same one from Step 1)
4. Click **Test Connection** — you should see your balance and realm count
5. (Optional) Select a **Default Realm** from the dropdown

### Step 4: Pull your posts

1. **Cmd+P** (Mac) or **Ctrl+P** (Windows) → type "pull"
2. Select **"Pull posts from Taggr"**
3. Your posts appear in the `taggr/` folder, organized by realm

### Step 5: Write and push

1. Create or edit a `.md` file in the `taggr/` folder (or a realm subfolder like `taggr/CRYPTO/`)
2. Make sure `published: true` is in the frontmatter (or use **Cmd+P** → "Create new Taggr post" for a template)
3. **Cmd+P** → **"Push changes to Taggr"**
4. Check taggr.link — your post is live

## Installation details

### Desktop (Mac / Windows / Linux)

See Step 2 above.

### Mobile (iOS and Android)

**Taggr IS your sync.** Each device syncs directly with the Taggr canister — no iCloud, no Obsidian Sync, no third-party service needed.

1. Download `main.js` and `manifest.json` to your phone (from the GitHub release)
2. In your Obsidian vault, create `.obsidian/plugins/taggr-sync/` (use the Files app on iOS, any file manager on Android)
3. Put both files in that folder
4. Open Obsidian → Settings → Community plugins → disable Restricted Mode → enable **Taggr Sync**
5. Enter your **handle** and **seed phrase** (same as on desktop)
6. Pull — your posts appear. Edit, push — changes go to Taggr. Open desktop, pull — changes are there.

No subscription. No cloud service. The blockchain is the sync layer.

## Configuration

Open Settings → Taggr Sync:

| Setting | Description |
|---------|-------------|
| **Taggr Handle** | Your username on taggr.link |
| **Seed Phrase** | Your Taggr login seed phrase (key derived locally, never sent anywhere) |
| **Identity Key (hex)** | Alternative: controller key for Internet Identity users (see Auth below) |
| **Sync Folder** | Vault folder for synced posts (default: `taggr`) |
| **Sync Direction** | Pull only, Push only, or Bidirectional |
| **Default Realm** | Realm for new posts — click "Test Connection" to load your realms |
| **Realm Filter** | Only pull posts from a specific realm (empty = all) |
| **Auto-sync Interval** | Minutes between automatic syncs (0 = manual only) |

Click **Test Connection** to verify your credentials. It shows your cycle balance, post count, and populates the realm dropdown.

## Authentication

Two methods are supported:

**Seed phrase (simplest):** Enter your Taggr seed phrase — the same one you created at signup on taggr.link. The key is derived locally (SHA-256 x 15,000 iterations → Ed25519) and never transmitted. Just fill in the Seed Phrase field, leave Identity Key empty.

**Controller key (for Internet Identity users):** If you log in to Taggr with Internet Identity, you can't use a seed phrase. Instead:
1. In the plugin settings, click **Generate Identity** — this creates a local Ed25519 key and copies the principal to your clipboard
2. Go to taggr.link → Account → **Add Controller** → paste the principal
3. The plugin can now post on your behalf. Leave the Seed Phrase field empty.

Use one or the other, not both. If both fields are filled, seed phrase takes priority.

## Usage

### Pulling posts

**Cmd+P** (desktop) or command palette (mobile) → **"Pull posts from Taggr"**

Posts are saved as markdown files organized by realm:

```
taggr/
├── CRYPTO/
│   ├── My crypto analysis.md
│   └── Market update.md
├── AI/
│   └── Thoughts on LLMs.md
└── _general/
    └── Hello world.md
```

Each file has YAML frontmatter tracking sync state:

```yaml
---
taggr_id: 1455999
taggr_user: 5619
taggr_realm: "CRYPTO"
taggr_timestamp: 1775455322776852000
taggr_hash: "5766e5ec"
taggr_patches: 0
taggr_cost: 11
published: true
taggr_status: "live on Taggr — uncheck published to delete from Taggr"
taggr_link: "https://taggr.link/#/post/1455999"
---

Your post content here in markdown.
```

### Pushing posts

**Cmd+P** → **"Push changes to Taggr"**

The plugin scans all `.md` files in the sync folder (including subfolders):

- Files **with** `taggr_id` and `published: true` → updates the existing post on Taggr
- Files **without** `taggr_id` and `published: true` → publishes as a new post
- Files with `published: false` and no `taggr_id` → local draft, ignored
- Files with `published: false` and `taggr_id` → **deletes the post from Taggr** (irreversible, file kept locally)
- Realm is determined by: subfolder name > frontmatter `taggr_realm` > default realm setting
- A notice shows your cycle balance and the cost per post (including images)

### Images

**Pull:** Taggr images are rendered inline in Obsidian via bucket canister URLs.

**Push:** Local images referenced in your post are automatically uploaded to Taggr:
- `![[image.png]]` — Obsidian embed format
- `![alt](./image.png)` — standard markdown
- Images over 450KB are automatically resized to fit Taggr's limit
- Each image gets a unique blob ID (SHA-256 hash)

### Backlinks

**Pull:** Taggr internal links `[text](#/post/ID)` become Obsidian backlinks `[[text]]`. User mentions `@username` become `[[@username]]`.

**Push:** Obsidian backlinks `[[Post Title]]` are converted to Taggr links `[Post Title](#/post/ID)` if the linked post is synced. `[[@username]]` becomes `@username`.

### Publish / Unpublish

The `published` checkbox in frontmatter controls the post's lifecycle:

| State | What happens at Push |
|-------|---------------------|
| `published: true` + no `taggr_id` | Publishes as new post on Taggr |
| `published: true` + has `taggr_id` | Syncs edits to existing post |
| `published: false` + no `taggr_id` | Local draft — ignored |
| `published: false` + has `taggr_id` | Deletes from Taggr (irreversible), file kept locally |

### Creating a new post

**Cmd+P** → **"Create new Taggr post"**

Creates a template file with the default realm pre-filled. Or just create a `.md` file manually in the realm subfolder you want.

### Full sync

**Cmd+P** → **"Sync with Taggr"** or click the **refresh icon** in the left sidebar.

## Commands

| Command | Action |
|---------|--------|
| Pull posts from Taggr | Fetch journal → create/update local files |
| Push changes to Taggr | Publish new posts / update changed posts / delete unpublished |
| Sync with Taggr | Pull then push |
| Create new Taggr post | New `.md` with frontmatter template |

## Costs

Every post on Taggr costs cycles (1000 credits = 1 XDR ≈ $1.37):

- **Text**: 2 cycles per KB of content (body + accumulated edit diffs)
- **Images**: ~9 cycles per 200KB image (linear by size, max 450KB per image)
- **Tags**: additional cost based on tag subscriber count
- **Reading (pull)** is always free

The total accumulated cost is shown in the `taggr_cost` frontmatter field and as a notification during push.

## Sync logic

- **Pull**: queries your journal via IC query calls (free, no cycles), compares content hashes, creates/updates local files
- **Push**: detects local changes by hash comparison, processes images, converts backlinks, calls `add_post` (new) or `edit_post` (update) via Candid-encoded IC update calls
- **Delete**: uncheck `published` → push → calls `delete_post` (JSON-encoded IC update call)
- **Conflicts**: if both local and remote changed since last sync, the local version is saved as `.conflict.md` and the remote version wins

## Building from source

```bash
git clone https://github.com/taggrobs/obsidian-taggr-sync.git
cd obsidian-taggr-sync
npm install
npm run build    # production → main.js (~295kb)
npm run dev      # development with sourcemaps
```

Copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/taggr-sync/` folder.

## Technical details

- Built with [@dfinity/agent](https://github.com/dfinity/agent-js) for Internet Computer communication
- Taggr uses hybrid encoding: JSON for queries and some updates, Candid IDL for post creation/editing
- Browser-compatible build (platform: browser with polyfills) — works on mobile
- Bundle size: ~295kb minified
- Canister ID: `6qfxa-ryaaa-aaaai-qbhsq-cai`

## Current limitations

- Seed phrase stored locally in plaintext (OS-level encryption planned)
- No offline queue — if push fails, retry manually
- Image upload works, video not yet
- Delete is irreversible on blockchain
- Conflict resolution is automatic (remote wins) — no manual merge UI

## Roadmap

- [ ] Encrypted seed phrase storage
- [ ] Offline push queue with retry
- [ ] Comment and engagement display in frontmatter
- [ ] MCP wrapper for AI agent access
- [ ] Encrypted realm support for private sync

## License

GPL-3.0 (matching Taggr's license)
