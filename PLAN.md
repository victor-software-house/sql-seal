# SQLSeal Plan

This file is the root implementation plan checkpoint for the fork. Keep it
small, current, and decision-oriented. Detailed feature plans may live under
`docs/features/`, but this file records which plan is active.

## Active Plan: Native MARKDOWN Renderer

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
5. Bump the version at patch level only.
6. Commit and push the implementation.
7. Create the release tag and GitHub release with `main.js`, `manifest.json`,
   and `styles.css` so BRAT can update the plugin on restart.

## Archived Plans

`docs/features/archive/materialize/` is historical only. It described writing
generated output back into vault files with guarded comment regions. That
direction is superseded by the native in-memory `MARKDOWN` renderer plan.
