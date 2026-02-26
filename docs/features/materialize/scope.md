# Implementation Scope

Phased plan, resolved design decisions, and open questions.

---

## Phase 1: Core Materialization (MVP)

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Marker parser | 1 day | `src/modules/editor/materialize/markerParser.ts` |
| Serializer (renderAsString + formatMarkdownTable) | 1 day | `src/modules/editor/materialize/serializer.ts`. Reuses `ParseResults.renderAsString()`, `LinkParser.renderAsString()` |
| Materializer (query execution + write-back) | 2 days | `src/modules/editor/materialize/materializer.ts`. Reuses `transformQuery()`, `db.select()`, `registerObservers()` |
| Anti-loop protection (write lock + debounce) | 1 day | `src/modules/editor/materialize/writeLock.ts` |
| Plugin integration (register on load, subscribe to bus) | 1 day | Extends `src/modules/sync/module.ts` or new `src/modules/materialize/module.ts` |
| Tests | 2 days | Marker parser, serializer parity with `renderAsString`, anti-loop, edge cases |
| **Phase 1 Total** | **8 days** | |

## Phase 2: Edit UX + Migration

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Hover edit button (Tier 2) | 2 days | `src/modules/editor/materialize/editWidget.ts`. `registerMarkdownPostProcessor` + `Modal` |
| Migration command | 1 day | `src/modules/editor/materialize/migrateCommand.ts` |
| List output format (`sqlseal-list`) | 0.5 day | Extension to serializer |
| **Phase 2 Total** | **3.5 days** | |

## Phase 3: CLI Companion

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Shared package extraction | 1 day | `packages/shared/` (marker parser, formatters, link serializer) |
| Vault indexer | 1.5 days | `packages/cli/src/vault-indexer.ts` |
| CLI materializer | 1.5 days | `packages/cli/src/materializer.ts` |
| Link resolver | 0.5 day | `packages/cli/src/link-resolver.ts` |
| CLI commands (`materialize`, `check`, `stale`) | 1 day | `packages/cli/src/index.ts` |
| Parity tests (CLI vs plugin output) | 1 day | Compare output for sample vault |
| **Phase 3 Total** | **6.5 days** | |

### Grand Total: ~18 days

---

## Resolved Design Decisions

1. **Post-processor for reading view?** Yes, but only for the edit button (Tier 2). The markdown table itself renders natively. The post-processor injects the edit button widget and a subtle visual indicator (thin top border or small icon) to distinguish materialized sections from static markdown.

2. **Timestamp in frontmatter?** No. The per-block timestamp in `<!-- sqlseal-updated: ... -->` is sufficient. A file-level frontmatter field would cause unnecessary noise and trigger metadataCache re-indexing on every materialization, worsening the loop problem.

3. **`--` encoding vs external files?** Both. Encoding is the default (transparent to users via the edit modal). External file import is the escape hatch for complex queries or queries shared across files.

4. **Non-table output?** Yes, via `sqlseal-list` directive. List format is needed for Canonical Sources and Related sections. Plain format deferred until a use case emerges.

---

## Open Questions

1. **Should the materializer run on all vault files or only open files?** Running on all files ensures consistency but may cause performance issues on large vaults. Running only on open files is cheaper but leaves background files stale. Recommendation: all files on startup, open files only during live editing. CLI handles full-vault materialization.

2. **Should auto-rename update the query comment?** When Obsidian auto-renames a wikilink in the materialized output, the output changes but the query hasn't re-executed. On the next materialization, the query will produce the old path (which now 404s). Should the materializer detect renamed paths in the output and update the query's `WHERE` clauses? Probably not — the query references table/column names, not specific paths. The next materialization will naturally produce the updated paths because the `files` table reflects the rename.

3. **Interaction with `vault.process()` and sync plugins.** If the user has Obsidian Sync or a git-based sync running, materialization writes could cause merge conflicts. Mitigation: the `<!-- sqlseal-updated: ... -->` timestamp changes on every write, making conflicts easy to resolve (accept either side, then re-materialize). Document this as a known limitation.
