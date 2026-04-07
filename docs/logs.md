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
