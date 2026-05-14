# AGENTS — Nested Frontmatter Access

Context for AI agents maintaining the dotted-path nested-frontmatter access
rewrite. Source of truth: `./README.md`.

## Status

Proposed (PRD only). Not yet implemented. The rewrite layer described in the
PRD does not exist in this branch; queries that use `post.status` syntax still
fail with `no such column: post.status`.

## Scope

The rewrite is a pre-execution SQL pass that converts
`<text_column>.<key1>[.<key2>...]` into
`json_extract(<text_column>, '$.key1[.key2...]')`. It must happen before the
worker `select(statement, frontmatter)` call and must operate on the
sql-parser-cst representation, not on regex strings.

Schema-aware disambiguation is non-negotiable:

- Standard SQL `table.column` references must be left alone.
- Table aliases declared in `FROM` / `JOIN` / CTE must be tracked and respected.
- Only TEXT-typed column LHS identifiers should be rewritten.

## Key Source Files

| File | Relevance |
|:-----|:----------|
| `src/modules/database/database.ts` | Add the rewrite call in `select()` and `explain()`. |
| `src/modules/database/worker/database.ts` | Reference: where TEXT columns are populated via `formatData()`'s `JSON.stringify` branch. Do not change storage. |
| `src/modules/sync/sync/tables/filesTable.ts` | Reference: where `extractFrontmatterFromFile` indexes only top-level keys. Do not change indexing. |
| `src/utils/sanitiseColumn.ts` | Reference: only top-level keys are sanitised; nested keys are never sanitised. |
| `sql-parser-cst` (npm) | Parser used for the rewrite visitor. Already a dependency. |
| `src/modules/database/rewrite/nestedFrontmatterAccess.ts` (to be created) | The visitor implementation. |
| `src/modules/database/rewrite/__tests__/nestedFrontmatterAccess.test.ts` (to be created) | Acceptance tests; categories enumerated in `README.md` § "Acceptance Criteria". |
| `src/modules/api/restApi.ts` | Verify REST API consumers receive equivalent results; consider surfacing the rewritten SQL under a debug field. |
| `docs/query-configuration.md` | Document the sugared syntax once the feature lands. |
| `docs/troubleshooting.md` | Document the fallback to `json_extract` for edge cases (quoted keys, special characters). |

## Non-Goals

- Do not materialize nested keys as separate `files` columns. The
  `extractFrontmatterFromFile` flattening surface stays unchanged.
- Do not change `formatData()` in the worker. The JSON-stringify branch is the
  intentional storage format.
- Do not introduce SQLite `->` / `->>` operators in this phase.
- Do not implement array indexing (`tags[0]`) in Phase 1. That is Phase 2.
- Do not write generated SQL back into vault files or notes.

## Implementation Order

1. Add the rewrite module with no integration. Land its tests first against
   pure CST round-trips. Keep `pnpm test` green throughout.
2. Wire the rewrite into `SqlSealDatabase.select()` and `SqlSealDatabase.explain()`
   behind a feature flag or unconditionally; either way, every existing test
   continues to pass.
3. Add the end-to-end vault test that round-trips `post: { status: 'sent' }`
   through the indexer and queries `post.status`.
4. Update `docs/query-configuration.md` and `docs/troubleshooting.md`.
5. Add the changeset (`minor`) and merge through the standard release lane.

## Release Rules

This is a `minor` bump under the fork's Changesets convention. The release
workflow (`AGENTS.md` § "Release Requirements") enforces the consecutive
non-patch override; coordinate with prior recent releases before merging.
