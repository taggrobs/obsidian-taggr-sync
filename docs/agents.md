# Agent Guide — obsidian-taggr-sync

You are reading the documentation for an Obsidian plugin that syncs a local vault bidirectionally with Taggr, a decentralized social publishing platform running on the Internet Computer blockchain.

## What this repo does

This plugin bridges two systems:

- **Obsidian** — a local-first markdown editor with backlinks, graph view, and plugin ecosystem
- **Taggr** — a social network canister (`6qfxa-ryaaa-aaaai-qbhsq-cai`) on the IC that stores posts as markdown

The plugin handles: pull (Taggr → local .md files), push (local .md → Taggr), image upload/download, backlink conversion, publish/delete lifecycle, cost estimation, and realm-based folder organization.

## Architecture

```
src/
  main.ts          — Plugin entry: commands, ribbon icon, auto-sync, settings tab registration
  taggr-client.ts  — IC agent wrapper: queries (JSON-encoded), updates (Candid IDL-encoded)
  sync-engine.ts   — Pull/push/conflict logic, frontmatter parsing, image processing, backlinks
  settings.ts      — Obsidian settings tab UI: handle, seed phrase, realm dropdowns, test connection
  types.ts         — TypeScript types: TaggrPost, TaggrUser, TaggrFrontmatter, settings
```

## Pagination & error handling

### Journal / user_posts fetching
- `fetchJournal(handle, page, offset)` returns `TaggrPost[] | null` — `null` on query error, `[]` when no more posts. This lets callers distinguish errors from end-of-data.
- `fetchAllJournal(handle, onProgress?)` wraps pagination with retries (3 attempts, exponential backoff 500ms/1s/2s). Throws on persistent failure instead of silently breaking. Safety limit: 200 pages (6000 posts).
- `fetchAllUserPosts(handle, onProgress?)` — same but uses the `user_posts` query (includes comments). Safety limit: 300 pages.
- Both log per-page progress to console: `[TaggrClient] Journal page N: X posts (total: Y)`.
- `sync-engine.pull()` catches errors from fetch and shows a clear Notice with the error message, directing the user to the console for details. Previously, pagination would silently break on the first error, causing "missing old posts" bugs.

## Comments handling

- Setting `pullComments` (default: false) toggles whether comments are pulled.
- When enabled, `pull()` uses `fetchAllUserPosts` (which queries `user_posts`) instead of `fetchAllJournal` (which queries `journal`).
- Comments (posts with `parent`) are stored in a dedicated `_comments/` subfolder at the root of the sync folder, regardless of realm. This prevents cluttering realm folders and keeps threaded context visually separated.
- Each comment's frontmatter includes `taggr_parent_id` and `taggr_parent_link` (direct URL to the parent post on Taggr). The parent post itself is NOT fetched locally — the user can click the link to open it on Taggr.
- `realmFromPath()` explicitly ignores `_comments` and `_general` folders when deducing realm for push.

## Communication with Taggr canister

Taggr uses a **hybrid encoding**, NOT standard Candid on all methods:

**Queries (reads, free):** Arguments are JSON-encoded as raw bytes via `TextEncoder`, NOT Candid.
```typescript
const arg = new TextEncoder().encode(JSON.stringify([domain, handle, page, offset]));
const response = await agent.query(canisterId, { methodName: "journal", arg });
const data = JSON.parse(new TextDecoder().decode(response.reply.arg));
```

**Updates (writes, cost cycles):** Arguments are Candid IDL-encoded.
```typescript
const arg = IDL.encode(
    [IDL.Text, IDL.Vec(IDL.Tuple(IDL.Text, IDL.Vec(IDL.Nat8))), ...],
    [body, blobs, ...]
);
```

**Exception:** `delete_post` is an update but uses JSON encoding (not Candid). This is a Taggr backend quirk — it uses `parse(&arg_data_raw())` which is serde_json, not the `#[update]` macro.

**API responses** return tuples `[Post, Meta]`, not flat objects. Always unwrap: `raw.map(([post]) => post)`.

**Domain parameter:** Queries like `journal` require `domain = "taggr.link"`, not empty string. Empty string returns 0 results because `state.domains.get("")` returns None.

## Key design decisions

### Hash-based change detection
- `taggr_hash` in frontmatter stores `simpleHash(rawTaggrBody)` — hash of the body as it exists on Taggr (before any Obsidian conversions like backlinks or blob URLs)
- At Pull: compare remote hash with saved hash. Match = skip, no rewrite
- At Push: convert local body back to Taggr format, hash it, compare with saved hash. Match = skip, no edit call
- This prevents the auto-sync infinite edit loop that consumed cycles

### Backlink conversion
- Pull: `[text](#/post/ID)` → `[[text]]`, `@username` → `[[@username]]`
- Push: `[[text]]` → `[text](#/post/ID)` (if post is synced), `[[@user]]` → `@user`
- Hash is always on the Taggr-format body (with `[text](#/post/ID)`), not the Obsidian-format body (with `[[text]]`)

### Image handling
- Pull: `/blob/xxx` → full bucket URL `https://{bucket}.raw.icp0.io/image?offset={offset}&len={len}` using data from `post.files`
- Push: local images (`![[file.png]]`, `![](./file.png)`, `!file.png`) → resize to ≤460KB → SHA-256 first 4 bytes as blob ID → `![WxH, Skb](/blob/ID)` → send as blobs parameter
- Blob cost: `total_bytes * 20 / 460800` cycles

### Publish/unpublish lifecycle
- `published: true` + no `taggr_id` → new post (add_post)
- `published: true` + has `taggr_id` → edit (edit_post)
- `published: false` + has `taggr_id` + not already deleted → delete (delete_post with JSON encoding)
- `published: false` + already deleted status → skip
- `published: false` + no `taggr_id` → local draft, skip

### Realm subfolders
- Pull creates `taggr/{REALM}/` subfolders. Posts without realm go to `_general/`
- Push deduces realm from subfolder name. Priority: frontmatter > subfolder > default setting

## Authentication

Two methods:

**Seed phrase (primary):** Same as taggr.link. `SHA-256 × 15,000 iterations → Ed25519KeyIdentity.generate(seed)`. Produces identical principal as the web app.

**Controller key (for II users):** Generate Ed25519 keypair locally, add principal as controller on Taggr account. Uses `Ed25519KeyIdentity.fromSecretKey(hexBytes)`.

Seed phrase takes priority if both are set.

## Build

```bash
npm install
npm run build    # production → main.js (~295kb)
```

`platform: "browser"` with polyfills (`url`, `util`, `buffer`, `stream-browserify`) for mobile compatibility. Obsidian and electron are external.

## Taggr source reference

The Taggr canister source is at `github.com/TaggrNetwork/Taggr`. Key files:
- `src/frontend/src/api.ts` — frontend API (encoding, call/query patterns)
- `src/frontend/src/authentication.tsx` — seed phrase hashing (line 70)
- `src/frontend/src/common.tsx:1060` — hash function (SHA-256 iterations)
- `src/frontend/src/form.tsx` — image upload, blob key generation, cost calculation
- `src/frontend/src/icons.tsx:821` — reaction ID → emoji mapping
- `src/backend/queries.rs` — query methods (journal, posts, user, tags_cost)
- `src/backend/updates.rs` — update methods (add_post, edit_post, delete_post)
- `src/backend/env/post.rs` — Post struct, costs(), blob_cost_by_size(), delete()
- `src/backend/env/config.rs` — CONFIG values (post_cost=2, blob_cost=20, max_blob_size=460800)
- `src/backend/lib.rs:37` — parse() is serde_json, NOT Candid

## Reading order for agents

1. This file (agents.md) — architecture and design decisions
2. `docs/logs.md` — chronological development log with justifications
3. `docs/roadmap.md` — planned features
4. `src/types.ts` — data structures
5. `src/taggr-client.ts` — canister communication
6. `src/sync-engine.ts` — core sync logic
7. `src/main.ts` — plugin entry point
8. `src/settings.ts` — UI
