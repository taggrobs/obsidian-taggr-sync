# Development Log — obsidian-taggr-sync

Chronological record of all changes, bugs found, and design decisions. Each entry explains what was done and why.

---

## 2026-04-06 — Session 1: Build, test, and ship

### Phase 1: Build & Fix
- Extracted prototype from `obsidian-taggr-sync.tar.gz` (5 TypeScript files)
- `npm install` — @dfinity/* packages installed (deprecated, migrated to @icp-sdk/core but still functional)
- `npm run build` — **passed first try**, zero compilation errors, 259kb bundle
- No code changes needed for initial build

### Phase 2: Read-only pull testing
- Created standalone test scripts to query Taggr mainnet
- **Bug found: domain parameter.** `journal` query with `domain=""` returns 0 posts. Taggr's `domain_realm_post_filter` does `state.domains.get("")` which returns None → empty iterator. Fix: use `domain="taggr.link"`. Confirmed `"6qfxa-ryaaa-aaaai-qbhsq-cai.icp0.io"` also works.
- **Bug found: tuple response format.** API returns `[Post, Meta]` tuples, not flat Post objects. Frontend code (`with_meta()` in post.rs) returns `(&Post, Meta)`. Fix: `.map(([post]) => post)` to unwrap.
- **Bug found: page size.** Taggr returns 30 posts per page (CONFIG.feed_page_size), not 25 as coded. Fixed.
- **Verified:** 1017 posts fetched for user X across 35 pages. Structure validation passed. Frontmatter roundtrip (build → parse → extract) passed.

### Phase 3: Sync engine testing
- Tested `parseFrontmatter`, `extractBody`, `postToFileName`, `simpleHash`
- Verified timestamp handling (nanoseconds, not safe integer but OK for our use)
- Verified frontmatter parsing with `---` in body (lazy regex works correctly)

### Phase 4: First Obsidian install
- Copied `main.js` + `manifest.json` to `.obsidian/plugins/taggr-sync/`
- **Failed to load.** Root cause: `platform: "node"` not set in esbuild, and `...builtins` in externals caused Node built-in modules to not be bundled. Fix: added `platform: "node"`, removed `...builtins` from externals.
- Plugin loaded and worked on desktop.

### Phase 5: Seed phrase authentication
- Investigated Taggr auth flow in `authentication.tsx`
- Implemented seed phrase → Ed25519 key derivation: `SHA-256 × 15,000 iterations → Ed25519KeyIdentity.generate(seed)`. Matches Taggr frontend exactly.
- Added `seedPhrase` field to settings UI
- **Bug found: push identity check.** Push only checked `identityKeyHex`, not `seedPhrase`. Fixed to check both.

### Phase 6: Mobile compatibility
- Changed `platform: "node"` → `platform: "browser"` — broke build (missing `url`, `util` modules)
- Installed browser polyfills: `url`, `util`, `buffer`, `stream-browserify`
- Added `alias: { "stream": "stream-browserify" }` in esbuild config
- Bundle size dropped from 348kb to 290kb
- Replaced `Buffer.from()` in settings.ts with `Array.from(new Uint8Array(...))` — only Node.js-specific usage
- **Tested on iOS:** plugin loads and syncs. Taggr IS the sync — no iCloud/Obsidian Sync needed per device.

### Phase 7: Realm subfolders
- Posts now organized by realm in vault: `taggr/CRYPTO/`, `taggr/AI/`, `taggr/_general/`
- Push deduces realm from subfolder name (priority: frontmatter > subfolder > default setting)
- `buildLocalIndex` and push file collection made recursive to scan subfolders

### Phase 8: Cost display
- Added `fetchUser(handle)` — queries user profile for cycles balance and realms
- Added `fetchTagsCost(tags)` — queries tag subscriber cost
- Added `estimateCost(body)` — calculates text + tags cost
- Added `calculatePostCost(post)` — full cost replay across all edits:
  - Initial: `post_cost × (body_len / 1KB + 1) + blob_cost`
  - Each edit: `post_cost × ((body_len + accumulated_patches_len) / 1KB + 1)`
  - Blob: `total_bytes × 20 / 460800` (charged once at creation)
- Cost shown in frontmatter (`taggr_cost`) and as Notice during push
- Balance shown at push start: "Pushing changes... (balance: X cycles)"

### Phase 9: Realm dropdown
- Test Connection now fetches user profile → caches `user.realms` in settings
- Realm Filter changed from text input to dropdown
- Default Realm for new posts as dropdown
- Both populated from cached realms list

### Phase 10: Image support
- **Pull:** `/blob/xxx` → full bucket URL using `post.files` data (`{blobId}@{bucketCanister}: [offset, len]`). URL format: `https://{bucket}.raw.icp0.io/image?offset={offset}&len={len}`
- **Push:** Detects local images in 3 formats:
  1. `![alt](./path.png)` — standard markdown
  2. `![[file.png]]` — Obsidian embed with brackets
  3. `!file.png` — Obsidian embed without brackets (stripped by some render modes)
- Resize pipeline: `createImageBitmap` → `OffscreenCanvas` → binary search JPEG quality → max 460KB
- Blob ID: SHA-256 first 4 bytes as 8-char hex (matches Taggr frontend)
- Blobs sent via `add_post`/`edit_post` Candid `blobs` parameter

### Phase 11: Backlinks
- **Pull:** `[text](#/post/ID)` → `[[text]]`, `@username` → `[[@username]]`
- **Push:** `[[Post Title]]` → `[Post Title](#/post/ID)` (if synced), `[[@user]]` → `@user`
- Builds reverse index `filename → taggr_id` for resolution

### Phase 12: Publish/unpublish
- `published: true` → sync normally
- `published: false` + `taggr_id` → delete from Taggr (`delete_post`)
- **Bug found: delete_post encoding.** `delete_post` uses JSON encoding (not Candid!) — it uses `parse(&arg_data_raw())` in Rust which is `serde_json::from_slice`. Other updates use `#[update]` macro (Candid).
- **Bug found: empty versions array.** `delete_post` with `versions=[]` doesn't mark post as deleted (`hashes` stays empty → `is_deleted()` returns false). Fix: send `[body]` as versions.
- **Bug found: delete then recreate.** After delete, file still in push loop → gets re-published. Fix: any file with `published: false` hits `continue` immediately after delete handling — never reaches create/edit code.
- Added `taggr_status` and `taggr_link` to frontmatter for clarity

### Phase 13: Engagement data
- Added `taggr_reactions` — human-readable summary: "fire:4, star:1, pirate:2"
- Added `taggr_comments` — count of direct children
- Added `taggr_tips` — total tips amount
- Reaction ID → name mapping from Taggr's `reaction2icon`: 1=downvote, 10=heart, 11=thumbsup, 12=sad, 50=fire, 51=laugh, 52=hundred, 53=rocket, 100=star, 101=pirate

### Phase 14: Auto-sync infinite edit loop (CRITICAL BUG)
- **Bug:** Auto-sync consumed cycles on every run even with no changes. Each sync would "update" all posts.
- **Root cause:** Hash mismatch between Pull and Push. At Pull, hash was calculated on body AFTER Obsidian conversions (backlinks `[[]]`, bucket URLs). At Push, body was converted back to Taggr format → different hash → "changed" → edit_post called.
- **Fix:** `taggr_hash` now always stores hash of the RAW Taggr body (before any conversions). Pull saves `simpleHash(post.body)` before blob/backlink conversion. Push converts local body back to Taggr format before hashing and comparing.
- **Also fixed:** Removed `needsMetaUpdate` which forced re-writes for missing metadata fields (reactions, status), causing Pull to always report "X updated".
- **Result:** Pull and Push both report 0 changes when nothing actually changed. Auto-sync is now safe.

### Phase 15: GitHub repo
- Created `taggrobs` GitHub account (anonymous)
- Removed all references to personal identity (author, placeholders, commit history)
- Published as `taggrobs/obsidian-taggr-sync` (public)
- Created v0.1.0 release with `main.js` + `manifest.json` for direct download

---

## 2026-04-07 — Session 2: User feedback fixes

### Phase 16: "Missing old posts" bug investigation
- **User feedback:** "I can only see posts from late March 2025 onward. Could it be that it only pulls the last year?"
- **Initial hypothesis:** 1-year server-side limit. Investigated Taggr backend for time-based filters. **None found** — `user.posts` Vec is iterated `.rev()` newest-to-oldest without any date cutoff. Archive system exists but archived posts are still accessible via `Post::get` (loads from stable memory into cache).
- **Tested journal query on multiple users:**
  - User X: 1019 posts across 33 pages, range 2021→2026 (4+ years)
  - digitalscape: 893 posts, range Feb 2024→April 2026 (2+ years)
  - Dp1: 578 posts, 165 ARTAG, range Jan→Sep 2024
  - vm: 974 posts, 134 ARTAG, range Jan→Dec 2024
  - All returned complete results. No 1-year cutoff.
- **Real root cause:** Silent pagination failure in `fetchAllJournal`. The loop broke on any error (network, timeout, instruction limit) because `queryJSON` returned `null` which became `[]` via `|| []`, making the loop think it reached the end. User had no idea anything failed.
- **Fix:**
  - `fetchJournal` now returns `TaggrPost[] | null` — `null` distinctly signals error
  - Added `fetchJournalPageWithRetry` with 3 retries and exponential backoff (500ms, 1s, 2s)
  - `fetchAllJournal` throws on persistent failure instead of silently breaking
  - Per-page console logging: `[TaggrClient] Journal page N: X posts (total: Y)`
  - Progress Notice every 10 pages during long pulls
  - Safety limit of 200 pages (6000 posts) to prevent infinite loops
  - `sync-engine.pull()` catches errors and shows a clear Notice with instructions to check the console

### Phase 17: Pull comments support
- **User feedback:** "Maybe there's no need to separate comments into 2 categories and it's just a matter of linking the OP at the top. Pulling the OP if you're not the author wouldn't make much sense."
- Added `pullComments` setting (toggle, default off)
- When enabled, uses `user_posts` query (includes comments via `with_comments: true` in the backend) instead of `journal` query (top-level only)
- Added `fetchUserPosts`, `fetchUserPostsPageWithRetry`, `fetchAllUserPosts` to taggr-client — parallel to journal methods, same retry/logging patterns
- Each comment gets `taggr_parent_id` and `taggr_parent_link` in frontmatter (direct URL to parent on Taggr)
- Parent post is NOT fetched or stored locally — only the link. The parent belongs to someone else most of the time, and cluttering the vault with others' posts wasn't desired.
- Comment file naming uses same logic as posts (first line as title, fallback to `taggr-{id}.md`)

### Phase 19: Deleted posts appearing as live (bug)
- **User feedback:** "I see files that were unpublished (deleted) being imported as regular posts"
- **Root cause:** `user_posts` query returns deleted posts (with empty body and populated `hashes` field). `journal` query filters them via `!post.is_deleted()` but `user_posts` does not. On Taggr, deleted posts are marked by setting `hashes` to non-empty and clearing body/patches/files. Our plugin was treating them as normal posts with empty body, creating files like `taggr-{id}.md` with `published: true`.
- **Fix:** In `sync-engine.pull()`:
  - Detect deleted posts via `Array.isArray(post.hashes) && post.hashes.length > 0`
  - If already exists locally and already marked deleted → skip
  - If exists locally and not yet marked → rewrite frontmatter with `published: false` + `taggr_status: "deleted from Taggr"` + `taggr_link`, preserve local body
  - If doesn't exist locally → skip entirely (don't create files for remote-only deleted posts)
  - Realm filter is bypassed for deleted posts since their realm data may be unreliable

### Phase 18: Dedicated comments folder
- **User feedback:** "I don't like this with comments because it's not clear what they belong to. On Taggr they have context, here they don't. Can we pull all comments in a dedicated comments folder so they don't visually pollute?"
- Comments now go into `taggr/_comments/` (flat, no realm subfolders) regardless of realm
- Top-level posts still organized in `taggr/{REALM}/` subfolders
- `realmFromPath()` updated to explicitly ignore both `_general` and `_comments` folders when deducing realm at push time
- Graph view in Obsidian can visualize connections via `taggr_parent_link` backlinks

---

## 2026-04-10 — Session 3: v0.1.0 release & community plugin submission

### Phase 20: Prepare v0.1.0 release
- Added GPL-3.0 `LICENSE` file (matching Taggr's license)
- Created `versions.json` for Obsidian compatibility tracking (`"0.1.0": "1.0.0"`)
- Created `.github/workflows/release.yml` — GitHub Actions workflow that auto-builds and creates a Release when a tag is pushed
- Polished `manifest.json` description for community plugin browser
- Rewrote `README.md` intro + added obsidian.taggr.social registration link
- Added `WHAT-IS-TAGGR.md` standalone explainer for new users
- **GitHub token scope issue:** Initial push was rejected because the PAT lacked `workflow` scope (required for pushing `.github/workflows/` files). Resolved by generating a new token with `workflow` scope.

### Phase 21: GitHub Release tag fix
- Original release was tagged `v0.1.0` — Obsidian requires the tag to match `manifest.json` version exactly (no `v` prefix)
- Deleted `v0.1.0` release, removed old tags
- Recreated release as `0.1.0` with all 3 required assets: `main.js`, `manifest.json`, `versions.json`
- Updated `manifest.json` description to remove the word "Obsidian" (community plugin guideline: redundant in plugin browser context)

### Phase 22: Community plugin submission PR
- Forked `obsidianmd/obsidian-releases` under `taggrobs` account
- Added entry to `community-plugins.json` (id: `taggr-sync`, repo: `taggrobs/obsidian-taggr-sync`)
- **First validation failure:** Bot ran on old PR body (before template update) — 3 errors: wrong template, "Obsidian" in description, `v` prefix on release tag
- Fixed all 3 issues, closed + reopened PR to re-trigger validation
- PR: obsidianmd/obsidian-releases#11813
- **Validation bot checks learned:**
  - PR body must contain exact template strings (substring match, not structure)
  - Description must end with `.?!)`, no "Obsidian", no "this plugin", max 250 chars
  - `community-plugins.json` description must match `manifest.json` description exactly
  - Release tag must match `manifest.version` exactly (no `v` prefix)
  - `maintainer_can_modify` must be `true`
  - Only `community-plugins.json` should be changed (1 file)

### Phase 23: Filename collision bug fix
- **User feedback:** "Plugin says 3996 items pulled but only ~760 files exist locally" (MntYetti). Same issue on radudaniel: 9000 fetched but only 52 files created.
- **Root cause 1:** `postToFileName()` generated filenames from the first line of post body (truncated to 80 chars) with no post ID. Multiple posts with identical first lines (especially comments like "Please remove the post before incurring...") produced the same filename. `vault.create()` threw "File already exists" which was uncaught, killing the entire pull loop.
- **Root cause 2:** `maxPages` was 200 (journal) / 300 (user_posts), too low for heavy users (radudaniel has 9986 posts = 333 pages).
- **Fix:**
  - `postToFileName()` now appends post ID: `Title (12345).md` — guarantees uniqueness
  - Added existence check before `vault.create()` with fallback to `taggr-{id}.md`
  - Wrapped `vault.create()` in try/catch — one failed file no longer kills the entire pull
  - Raised `maxPages` to 500 for both journal and user_posts (supports up to 15000 posts)

### Phase 24: Human-readable date in frontmatter
- Replaced `taggr_timestamp: 1710513000000000000` (nanoseconds) with `taggr_date: "2024-03-15 14:30"` (UTC)
- `parseFrontmatter` reads both `taggr_date` and legacy `taggr_timestamp` for backwards compatibility
- Does not affect hash-based change detection (hash is on body only, not frontmatter)

