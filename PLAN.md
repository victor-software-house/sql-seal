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

Implementation checkpoint:

1. Extend renderer context with `app` and lifecycle component support.
2. Allow renderer `render(...)` to be async and await it from the codeblock
   processor and REST endpoint.
3. Replace `src/modules/editor/renderer/MarkdownRenderer.ts` with a
   Nunjucks-backed markdown renderer using `MarkdownRenderer.render(...)`.
4. Add a nested `sqlseal` fence guard with a clear renderer error.
5. Keep compatibility fallback for `MARKDOWN` without a template body by
   generating a markdown table and rendering it through Obsidian.
6. Update docs and changelog when implemented.

Required tests:

- `MARKDOWN` calls Obsidian `MarkdownRenderer.render(...)`.
- Template context includes `data`, `columns`, and `properties`.
- No-template fallback is rendered by Obsidian, not inserted as raw text.
- Nested `sqlseal` fences are rejected.
- `/sqlseal/query` returns rendered `html` for `MARKDOWN` blocks.
- Lifecycle cleanup is attached to the SQLSeal codeblock processor or REST
  rendering component.

## Archived Plans

`docs/features/archive/materialize/` is historical only. It described writing
generated output back into vault files with guarded comment regions. That
direction is superseded by the native in-memory `MARKDOWN` renderer plan.
