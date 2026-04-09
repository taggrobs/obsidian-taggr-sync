# Roadmap — obsidian-taggr-sync

## Completed (v0.1.2)

- [x] **Robust pagination with retries** — 3 attempts with exponential backoff per page, throws on persistent error instead of silently breaking
- [x] **Per-page progress logging** — console logs and progress Notices every 10 pages during long pulls
- [x] **Pull comments toggle** — `pullComments` setting enables fetching via `user_posts` (includes comments)
- [x] **Dedicated comments folder** — comments stored in `_comments/` flat folder, not mixed with realm posts
- [x] **Parent post link in comment frontmatter** — `taggr_parent_id` and `taggr_parent_link` fields
- [x] **Clear error reporting** — failed pulls now show a Notice with the exact error, directing users to the console

## Completed (v0.1.0)

- [x] Pull posts from Taggr journal
- [x] Push new posts and edits
- [x] Seed phrase authentication (same as taggr.link)
- [x] Controller key authentication (for Internet Identity users)
- [x] Realm subfolders (auto-organize by realm)
- [x] Realm dropdown in settings (filter + default)
- [x] Image pull (inline via bucket canister URLs)
- [x] Image upload (resize, blob ID, push to canister)
- [x] Bidirectional backlinks ([[]] ↔ #/post/ID)
- [x] @username mention conversion
- [x] Cost display per post (text + images + edit history)
- [x] Balance display at push time
- [x] Publish/unpublish lifecycle (checkbox → delete from Taggr)
- [x] Status + direct Taggr link in frontmatter
- [x] Engagement data (reactions, comments count, tips)
- [x] Mobile support (iOS + Android, platform: browser build)
- [x] Auto-sync on interval (safe, no wasted cycles)
- [x] Conflict detection (remote wins, local .conflict.md backup)

## Short-term

- [ ] **Encrypted seed phrase storage** — currently stored in plaintext in `data.json`. Options: OS keychain (Mac Keychain, iOS Secure Enclave), or encrypt with master password at session start.
- [ ] **Offline push queue** — if push fails (no network), queue the edit and retry on next sync instead of silently failing.
- [ ] **Video upload** — Taggr supports blobs up to 460KB. Video would need chunking or link-only approach.
- [ ] **Selective sync** — choose which posts to pull instead of full journal. Filter by date range, tags, or specific post IDs.

## Medium-term

- [ ] **Comment display** — show comments as collapsible callouts at the end of each post (read-only). Data is available via `post.children` → `fetchPosts(ids)`.
- [ ] **Engagement tracking over time** — store reaction/comment counts in a separate index file, track growth per post.
- [ ] **Manual merge UI for conflicts** — instead of "remote wins", show a diff view and let user choose per-conflict.
- [ ] **Multi-account support** — switch between Taggr accounts within the same vault.
- [ ] **Taggr notifications in Obsidian** — pull notification data from user profile, show as Notice or in a sidebar.

## Long-term

- [ ] **MCP wrapper** — expose plugin functionality as an MCP server so AI agents (Claude, GPT) can read/write to the vault and Taggr simultaneously. This would allow agents to publish research, summarize engagement, or manage a content calendar.
- [ ] **Encrypted realm support** — if Taggr implements encrypted/private realms, enable private vault sync through the blockchain. Encrypted notes, synced across devices via IC, accessible only to authorized principals.
- [ ] **Submit to Obsidian community plugins** — PR on `obsidianmd/obsidian-releases` to appear in the official plugin browser. Requires review process compliance.
- [ ] **Taggr as full vault backend** — replace Obsidian Sync entirely. Every note (not just published posts) stored encrypted on IC. This would make Taggr a true decentralized Obsidian backend.

## Won't do (out of scope)

- Real-time collaborative editing (Taggr is not a CRDT system)
- Obsidian → Taggr theme sync (different rendering engines)
- Taggr governance/DAO integration (voting, proposals — separate tool)
