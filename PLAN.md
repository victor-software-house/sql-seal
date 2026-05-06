# SQLSeal Plan

This file is the root implementation plan checkpoint for the fork. Keep it
small, current, and decision-oriented. Detailed feature plans may live under
`docs/features/`, but this file records which plan is active.

## Active Roadmap

This fork should move in small, reviewable phases. Do not rebase or merge
upstream wholesale; upstream changes are selectively adopted into the fork after
tests prove the local behavior.

Primary evidence:

- Native markdown renderer design:
  `docs/features/native-markdown-renderer/README.md`
- Upstream hiatus analysis:
  `docs/reports/upstream-hiatus-2026-05-06/README.md`
- Release rules:
  `AGENTS.md`

## Completed Prep

These items are already done and should be preserved while implementing the next
phases:

1. Root repo planning exists in this file.
2. The materialization plan is archived under
   `docs/features/archive/materialize/` and must not be revived without a new
   explicit decision.
3. SQLSeal Local REST API requests run through the codeblock parser pipeline,
   including `TABLE ... = file(...)`, table alias rewriting, file/frontmatter
   bind variables, and renderer selection.
4. The fork has a Changesets release lane with human-gated release PRs.
5. Release workflow gates run `release:guard`, typecheck, Jest, and production
   build before opening/updating a release PR or publishing a merged release.
6. Patch is the default bump level. Consecutive `minor` or consecutive `major`
   releases require a reviewed
   `.changeset/allow-consecutive-nonpatch.json` override.
7. Upstream `h-sphere/sql-seal` was fetched and analyzed through upstream
   `0.40.1` / `8972c9c`.

## Phase 1: Upstream Safety Prep

Goal: adopt low-risk upstream fixes that reduce parser/editor risk before the
native `MARKDOWN` rewrite.

1. Port upstream parser `SELECT` boundary fix from `03dfcd7`.
   - Keep the fork's `nunjucksTemplate` grammar.
   - Add fork-specific parser tests for `SELECT` or `WITH` appearing inside
     renderer config and templates.
   - Confirm upcoming multi-line `MARKDOWN` templates parse correctly.
2. Port task raw `status` column from `c856713`.
   - Add sync table tests for `/`, `-`, space, and `x` task states.
   - Preserve existing `completed` and interactive `checkbox` behavior.
3. Consider callout syntax highlighting fix from `d9cb4d5`.
   - Adopt only if the upstream extraction helper ports cleanly.
   - Keep it separate from runtime renderer changes.

Release as a patch unless the user explicitly approves otherwise.

## Phase 2: Native MARKDOWN Renderer

Source of truth: `docs/features/native-markdown-renderer/README.md`

Goal: replace the current `MARKDOWN` renderer behavior with native
Obsidian-rendered markdown.

Current problem:

- `MARKDOWN` currently generates a plain markdown table with
  `markdown-table-ts`.
- The renderer inserts that table as text, so Obsidian never parses it.
- The output looks like raw ASCII and does not behave like normal Obsidian
  markdown.

Decision:

- `MARKDOWN` should render Nunjucks-generated markdown through Obsidian's own
  `MarkdownRenderer.render(...)`.
- `TEMPLATE` remains the raw HTML/Nunjucks renderer for precise HTML output.
- Raw markdown/table text should not keep the `MARKDOWN` name. If needed later,
  add an explicit renderer such as `RAW` or `MARKDOWN_RAW`.
- Generated markdown must not contain nested `sqlseal` fenced codeblocks in the
  first implementation. Use `sql`, `md`, `markdown`, or escaped fences to show
  examples.
- Do not implement background materialization or write generated output back to
  vault files for this plan.

Implementation sequence:

1. Baseline current behavior in tests before changing the renderer pipeline.
   Cover the parser, current `MARKDOWN` behavior, and `/sqlseal/query` response
   shape so regressions are explicit.
2. Extend renderer context with `app` and lifecycle component support.
3. Allow renderer `render(...)` to be async and await it from the codeblock
   processor and REST endpoint.
4. Replace `src/modules/editor/renderer/MarkdownRenderer.ts` with a
   Nunjucks-backed markdown renderer using `MarkdownRenderer.render(...)`.
5. Add a nested `sqlseal` fence guard with a clear renderer error.
6. Keep compatibility fallback for `MARKDOWN` without a template body by
   generating a markdown table and rendering it through Obsidian.
7. Tighten REST rendering so `/sqlseal/query` awaits renderer output and returns
   the rendered `html` for `MARKDOWN` blocks.
8. Validate through the Obsidian vault query helper against real SQLSeal blocks,
   not only Jest mocks.
9. Update docs and changelog when implemented.
10. Release with a patch-level version bump only, then tag and publish the BRAT
    assets.

Required tests:

- Parser accepts the new multi-line `MARKDOWN` template form.
- `MARKDOWN` calls Obsidian `MarkdownRenderer.render(...)`.
- Template context includes `data`, `columns`, and `properties`.
- No-template fallback is rendered by Obsidian, not inserted as raw text.
- Nested `sqlseal` fences are rejected.
- `/sqlseal/query` returns rendered `html` for `MARKDOWN` blocks.
- Lifecycle cleanup is attached to the SQLSeal codeblock processor or REST
  rendering component.

Verification and release:

1. Run `pnpm run typecheck`.
2. Run `pnpm test --runInBand`.
3. Run `pnpm run build`.
4. Use the Obsidian vault query helper to render at least one real `MARKDOWN`
   block and one existing `TEMPLATE` block.
5. Add a patch changeset.
6. Commit and push the implementation.
7. Let the release workflow open or update the Changesets release PR.
8. Publish only by merging the release PR, unless the user explicitly requests
   the documented emergency release path.

## Phase 3: Upstream Query and Data Features

Goal: integrate upstream features that are useful to this fork without pulling
the upstream renderer or release model back in.

1. Port `TAGS()` macro and multi-tag `AND` auto-detection from `c038366`.
   - Add tests around aliases, table remapping, `@param` bindings, and mixed
     conditions.
   - Decide explicitly whether auto-detection is enabled by default in this
     fork.
   - Prefer reimplementing the idea against the fork's transformer tests over a
     blind cherry-pick.
2. Evaluate JSONL / NDJSON support from `fc24a4f`.
   - Defer until a real vault workflow needs append-only structured data.
   - If adopted, include settings UI, sync strategy tests, and helper
     validation.
3. Selectively adopt production log suppression from `b852977` / `33e19df`.
   - Avoid backend-specific config changes until the database migration phase.

Release each coherent adoption as a patch unless the user explicitly approves a
larger bump.

## Phase 4: Database Backend Evaluation

Goal: evaluate upstream's `wa-sqlite` migration without destabilizing current
vault workflows.

Upstream commits: `bf085fe`, `33e19df`, `42a6541`, releases `6d4dcc5` and
`8972c9c`.

Rules:

1. Use a dedicated migration branch.
2. Do not combine this with renderer, REST, or upstream query-feature work.
3. Baseline current database, sync, explorer, and REST behavior with tests
   before changing the backend.
4. Port the upstream mobile/init fixes with the migration, not later.
5. Verify with:
   - `pnpm run release:guard`
   - `pnpm run typecheck`
   - `pnpm test --runInBand`
   - `pnpm run build`
   - SQLSeal REST helper against real vault fixtures
   - Obsidian smoke test for CSV-backed tables, global `files`/`tasks` tables,
     `.sql`/`.sqlseal` explorer files, and BRAT-built assets.

Decision checkpoint: keep `wa-sqlite` only if it preserves existing fork
features and materially improves maintenance, mobile behavior, or reliability.

## Release Discipline

Every implementation phase should use the normal gated release path:

1. Add one `.changeset/*.md` file per user-visible change.
2. Default the bump to `patch`.
3. Run `pnpm run release:guard` before pushing.
4. Push the implementation branch or `main` change.
5. Let GitHub Actions open/update the release PR.
6. Human reviews and merges the release PR.
7. The next release workflow run tags and publishes `main.js`,
   `manifest.json`, and `styles.css` for BRAT.

## Archived Plans

`docs/features/archive/materialize/` is historical only. It described writing
generated output back into vault files with guarded comment regions. That
direction is superseded by the native in-memory `MARKDOWN` renderer plan.
