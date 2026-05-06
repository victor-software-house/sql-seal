---
title: Upstream Hiatus Analysis
report_type: upstream_forensics
scope: sqlseal-fork
created: 2026-05-06
timezone: America/Fortaleza
fork_repository: victor-software-house/sql-seal
upstream_repository: h-sphere/sql-seal
common_base:
  commit: bf24096d75240d6fb11ea944a64b763f0c7bafee
  short_commit: bf24096
  tag: 0.39.1
  commit_date_brt: 2025-09-18T07:21:12-03:00
  subject: "release: Release Next (#192)"
fork_head:
  commit: db8d7053dc97bce149c2e44775b1608c3b17fd82
  short_commit: db8d705
  branch: main
  commit_date_brt: 2026-05-06T14:06:04-03:00
  subject: "docs: codify markdown renderer rollout"
latest_upstream_commit_analyzed:
  commit: 8972c9c7f428109a661c6dfa8bd2f90167b55e68
  short_commit: 8972c9c
  tag: 0.40.1
  commit_date_brt: 2026-05-04T06:52:55-03:00
  subject: "release: Release 0.40.1 (#211)"
analysis_range: "bf24096d75240d6fb11ea944a64b763f0c7bafee..upstream/main"
upstream_commit_traversal: "first-parent reverse, to ignore branch side history"
source_references:
  - label: Upstream compare from common base to analyzed head
    url: https://github.com/h-sphere/sql-seal/compare/bf24096d75240d6fb11ea944a64b763f0c7bafee...8972c9c7f428109a661c6dfa8bd2f90167b55e68
  - label: Fork repository head
    url: https://github.com/victor-software-house/sql-seal/commit/db8d7053dc97bce149c2e44775b1608c3b17fd82
  - label: Upstream commit chain JSON
    path: docs/reports/upstream-hiatus-2026-05-06/data/upstream-main-first-parent-commits.json
  - label: Upstream commit chain CSV
    path: docs/reports/upstream-hiatus-2026-05-06/data/upstream-main-first-parent-commits.csv
  - label: Unified upstream diff
    path: docs/reports/upstream-hiatus-2026-05-06/data/upstream-main-since-common-base.diff
  - label: Upstream diff stat
    path: docs/reports/upstream-hiatus-2026-05-06/data/upstream-main-since-common-base.stat
  - label: Upstream changed files
    path: docs/reports/upstream-hiatus-2026-05-06/data/upstream-main-since-common-base.name-status
---

# Upstream Hiatus Analysis

## Main Facts

Upstream is active. The latest upstream `main` commit analyzed is
`8972c9c` / `0.40.1`, released on 2026-05-04 at 06:52:55 BRT. That is two days
before this report.

The fork and upstream share `bf24096` / `0.39.1` as their latest common base.
Since then, upstream added 12 first-parent commits on `main`. The fork added its
own divergent line through `db8d705`, including Nunjucks `TEMPLATE`, vault
template includes, `parent` / `depth` columns, the Local REST API endpoint, and
the native `MARKDOWN` renderer plan.

The upstream-side unified diff from `0.39.1` to `0.40.1` is stored at
`data/upstream-main-since-common-base.diff`. Its stat is 85 files changed, 3,628
insertions, and 1,742 deletions. The fork-side diff over the same base touches
60 files. Sixteen paths overlap, including `package.json`, `pnpm-lock.yaml`,
`manifest.json`, `CHANGELOG.md`, the parser, API wiring, editor init, main
module wiring, and `filesTable.ts`.

The upstream history in this period is concentrated in one architectural move
and a set of smaller product fixes:

| Area | Upstream commits | Practical meaning |
|:-----|:-----------------|:------------------|
| Database engine | `bf085fe`, `33e19df`, `42a6541`, releases `6d4dcc5` and `8972c9c` | Migration from the old sql.js / absurd-sql backend to `wa-sqlite`, plus first-run and mobile initialization fixes. |
| Query language | `c038366`, `03dfcd7` | `TAGS()` macro, auto-detection for impossible multi-tag `AND` filters, and safer `SELECT` boundary parsing. |
| Data sources | `fc24a4f` | JSONL / NDJSON file sync and sidebar preview. |
| Vault tables | `c856713` | Raw task status symbol exposed in the `tasks` table. |
| Editor UX | `d9cb4d5` | Syntax highlighting works inside Obsidian callouts. |
| Release/build hygiene | `f57e0f5`, `b852977`, `33e19df` | Release-title automation, fewer production logs, logger/config cleanup. |

## Analysis

Do not rebase or merge upstream wholesale. The fork has intentionally diverged
in user-facing renderer behavior and API shape. Upstream still carries
Handlebars-era assumptions, while the fork has moved to Nunjucks and reusable
vault templates. A direct upstream merge would mix two renderer directions at
exactly the same time that this fork is preparing the native `MARKDOWN`
renderer work.

The right strategy is selective adoption by feature. Small semantic fixes can be
ported directly with focused tests. Larger substrate changes, especially
`wa-sqlite`, need their own branch and compatibility review because they touch
database lifecycle, worker setup, sync tables, explorer DB handling, build
configuration, Jest configuration, and package dependencies.

The strongest short-term upstream pulls are parser safety, task status exposure,
and maybe callout syntax highlighting. These are useful, bounded, and do not
compete with the native `MARKDOWN` renderer plan. `TAGS()` is also valuable, but
it changes SQL transformation semantics and should be staged after parser tests
are expanded. JSONL is useful but not urgent for the current SDLC bookkeeping
workflow, which is CSV-centered.

The database migration is strategically important but operationally expensive.
Upstream's 0.40.1 patch exists specifically because the migration needed mobile
and initialization fixes after release. That is not a reason to reject it, but
it is a reason to isolate it from the renderer/API work and treat it as a
separate technical migration with vault regression testing.

## Upstream Evolution

| Seq | Commit | Date BRT | Subject | Files | Add / Del |
|:----|:-------|:---------|:--------|------:|----------:|
| 1 | [`bf085fe`](https://github.com/h-sphere/sql-seal/commit/bf085fe896f330e2a4f224a7891034004e8e0e2a) | 2026-03-22 15:01 | Migrating SQL Engine to wa-sqlite (#193) | 60 | 2,250 / 1,672 |
| 2 | [`f57e0f5`](https://github.com/h-sphere/sql-seal/commit/f57e0f5a0009dbf18a6871ca77ddc7db68ba497f) | 2026-03-22 20:07 | fix: include release version in PR title and commit name (#204) | 1 | 12 / 5 |
| 3 | [`d9cb4d5`](https://github.com/h-sphere/sql-seal/commit/d9cb4d5feaa8d433fa912e9d536bafb9b22e1b82) | 2026-03-29 06:43 | fix: restore syntax highlighting inside Obsidian callouts (#205) | 4 | 211 / 29 |
| 4 | [`03dfcd7`](https://github.com/h-sphere/sql-seal/commit/03dfcd78b27c5f2fad0ce1998526a2a4ad93733c) | 2026-03-29 07:15 | fix(parser): fixing select keyword parsing outside the SQL queries (#206) | 3 | 115 / 1 |
| 5 | [`c856713`](https://github.com/h-sphere/sql-seal/commit/c8567131cd52587ae49acb7402bfb9a52c3388b9) | 2026-03-29 16:31 | feat: expose task status symbol in tasks table (#207) | 6 | 138 / 6 |
| 6 | [`fc24a4f`](https://github.com/h-sphere/sql-seal/commit/fc24a4f9c048d21322ba2ccbbdad3f6f9163335a) | 2026-04-06 08:36 | feat: add JSONL/NDJSON file format support with sidebar preview (#203) | 9 | 351 / 1 |
| 7 | [`b852977`](https://github.com/h-sphere/sql-seal/commit/b852977496fe54763e13acdf0669d5fc261b7b68) | 2026-04-06 08:37 | chore: Disabling console logs on production builds (#208) | 2 | 6 / 1 |
| 8 | [`c038366`](https://github.com/h-sphere/sql-seal/commit/c038366783892f516324b10d34c092aea77ef40c) | 2026-04-06 08:50 | feat: add TAGS() macro and auto-detection for multi-tag AND queries (#202) | 8 | 406 / 22 |
| 9 | [`33e19df`](https://github.com/h-sphere/sql-seal/commit/33e19df3db1ae38df09a404efbfca793967e437c) | 2026-04-07 04:53 | fix: fixing issue with config and extra logs (#209) | 8 | 167 / 89 |
| 10 | [`6d4dcc5`](https://github.com/h-sphere/sql-seal/commit/6d4dcc5ece28ecb2ef24eb81458f0f38633d2d96) | 2026-04-12 06:46 | Release 0.40.0 (#201) | 13 | 122 / 43 |
| 11 | [`42a6541`](https://github.com/h-sphere/sql-seal/commit/42a65416509cb1a47276cb300b47b446630faa57) | 2026-05-04 06:51 | fix: wa-sqlite initialisation fix (#210) | 7 | 32 / 57 |
| 12 | [`8972c9c`](https://github.com/h-sphere/sql-seal/commit/8972c9c7f428109a661c6dfa8bd2f90167b55e68) | 2026-05-04 06:52 | release: Release 0.40.1 (#211) | 5 | 10 / 8 |

## Key Changes and Fork Adoption Decisions

| Upstream change | Relation to fork | Pros | Cons / risks | Decision |
|:----------------|:-----------------|:-----|:-------------|:---------|
| `wa-sqlite` database backend | Fork still uses the pre-0.40 sql.js / absurd-sql backend. The fork's REST endpoint and renderer plans currently type against `SqlSealDatabase`. | More current upstream substrate, likely better maintained path, explicit mobile follow-up fixes, cleaner modern Jest setup. | Very broad surface: database module, worker, explorer memory DB, sync lifecycle, build config, lockfile, tests. Could destabilize REST and SDLC vault usage. | Defer. Create a separate migration branch after native `MARKDOWN`; port as a technical migration, not mixed with renderer work. |
| `TAGS()` macro and multi-tag `AND` auto-detection | Fork has not adopted it. It touches `sqlTransformer.ts`, which the fork also uses for REST and table alias mapping. | High user value. Prevents a common wrong query pattern and adds an explicit macro for intersection-style tag filtering. | SQL rewrite semantics become more magical. Needs tests around aliases, existing table remapping, and `@param` bindings. | Adopt soon, after parser baseline. Prefer reimplementing from upstream concept with fork tests rather than blind cherry-pick. |
| Parser `SELECT` boundary fix | Fork parser still treats `SELECT` / `WITH` as bare keywords. This matters more once `MARKDOWN` becomes multi-line Nunjucks. | Small, high leverage, directly reduces false query starts inside config/template text. | Must re-run parser tests with fork's `nunjucksTemplate` grammar and upcoming `MARKDOWN` grammar. | Adopt immediately before native `MARKDOWN` implementation. |
| Task raw status column | Fork currently has interactive checkbox data and completed status, but not the raw task marker as a queryable `status` column. | Useful for Obsidian task workflows: can distinguish `/`, `-`, space, and `x` states. Bounded implementation. | Requires table schema change and tests; existing queries may see an extra column but should not break. | Adopt soon. Low conflict and useful for the vault. |
| JSONL / NDJSON data source | Fork SDLC workflow currently depends on curated CSV tables and SQLSeal `TABLE ... = file(...)`. | Valuable for logs, event streams, and append-only structured data. Sidebar preview is a nice usability addition. | Adds settings UI and a new sync strategy. Not needed for the current bookkeeping path. | Optional. Defer until there is a concrete JSONL source to query. |
| Syntax highlighting inside callouts | Fork has the old syntax highlighting extraction behavior. | Good editor UX fix with dedicated tests upstream. Helps notes that put SQLSeal blocks in Obsidian callouts. | Touches editor-extension code and tests; not core runtime behavior. | Adopt when touching syntax highlighting or if callout blocks become common. |
| Production log suppression and config cleanup | Fork can benefit from less noisy production logs, but upstream cleanup is partly coupled to `wa-sqlite`. | Cleaner console, fewer debug leaks, better first-run behavior. | Some changes are backend-specific; cherry-picking without the backend migration may be misleading. | Selectively adopt logger suppression; keep backend-specific config fixes with the `wa-sqlite` migration. |
| Release workflow title/version automation | Fork now has explicit BRAT release rules and patch-only default in `AGENTS.md`. | Upstream changes are useful for upstream's Changesets flow. | Fork release policy intentionally differs: patch-only unless instructed, GitHub release assets for BRAT. | Do not adopt wholesale. Keep fork release rules. |

## Suggested Adoption Order

1. Port parser `SELECT` boundary fix with fork-specific parser tests.
2. Implement native `MARKDOWN` according to `PLAN.md`.
3. Port task raw `status` column with sync table tests.
4. Port `TAGS()` macro and decide whether auto-detection should be enabled by
   default in the fork.
5. Port callout syntax highlighting if the editor-extension tests stay isolated.
6. Evaluate JSONL / NDJSON only when a real vault workflow needs it.
7. Evaluate `wa-sqlite` in a dedicated branch with full build, Jest, REST helper,
   and Obsidian vault smoke tests.

## Evidence Files

| Artifact | Purpose |
|:---------|:--------|
| `data/upstream-main-first-parent-commits.json` | Structured commit chain from common base to upstream `main`. |
| `data/upstream-main-first-parent-commits.csv` | CSV version of the same first-parent commit chain. |
| `data/upstream-main-since-common-base.diff` | Unified diff for upstream `bf24096..8972c9c`. |
| `data/upstream-main-since-common-base.stat` | Diff stat summary for the upstream range. |
| `data/upstream-main-since-common-base.name-status` | Added, modified, and deleted file list for the upstream range. |
| `data/upstream-main-since-common-base.numstat` | Numeric add/delete data by file for the upstream range. |
