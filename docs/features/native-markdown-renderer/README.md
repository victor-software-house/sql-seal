# Native MARKDOWN Renderer Plan

Status: active implementation plan.

The `MARKDOWN` renderer should mean "render generated markdown with Obsidian's
own markdown engine." It should no longer mean "show a raw ASCII markdown table
inside a text div."

## Decision

Replace the current `MARKDOWN` renderer behavior with a Nunjucks-backed markdown
renderer that:

1. executes SQL through the existing SQLSeal query pipeline;
2. converts result cells to markdown-safe strings through `ParseResults`;
3. renders a Nunjucks template with `{ data, columns, properties }`;
4. passes the generated markdown to `MarkdownRenderer.render(app, markdown, el, sourcePath, component)`;
5. returns rendered HTML in the REST API response when rendering through `/sqlseal/query`.

This is an in-memory renderer. It must not mutate the source note or write
generated output back to the vault.

## Rationale

The current `MARKDOWN` renderer uses `markdown-table-ts` to create a plain text
markdown table, then inserts it with `createDiv({ text: tab })`. Obsidian never
parses that output, so links, tables, callouts, headings, embeds, and theme
styling do not behave like normal markdown. The result is useful only as a
copy/export artifact and is a poor presentation renderer.

SQLSeal already has the required primitive: `MarkdownTableSyncStrategy` renders
markdown into a temporary element with Obsidian's `MarkdownRenderer.render(...)`.
The native `MARKDOWN` renderer should use the same Obsidian engine for
presentation.

## Syntax

`MARKDOWN` becomes a multi-line renderer like `TEMPLATE`. Everything between the
renderer declaration and the SQL query is a Nunjucks markdown template.

````markdown
```sqlseal
MARKDOWN
{% for row in data %}
### {{ row.issue_key }}

**Status:** {{ row.status }}

{{ row.note }}

[Open]({{ row.url }})
{% endfor %}

SELECT
  key_ AS issue_key,
  status,
  note,
  url
FROM jira_issues
WHERE key_ = @title
```
````

If no template body is provided, `MARKDOWN` may fall back to a generated markdown
table for compatibility, but that table must still be rendered through
Obsidian's markdown engine rather than inserted as raw text.

## Raw Markdown

Raw markdown display is not the primary SQLSeal `MARKDOWN` behavior. Users who
want raw markdown examples should use normal markdown fences such as `md` or
`markdown` in their notes.

If a SQLSeal-owned raw output mode is needed later, add it under an explicit
name such as `RAW` or `MARKDOWN_RAW`. Do not preserve raw ASCII output under the
`MARKDOWN` name.

## Nested SQLSeal Blocks

Generated markdown must not contain nested `sqlseal` fenced codeblocks in the
first implementation.

Obsidian's markdown renderer may be able to invoke markdown post-processors
recursively, but nested SQLSeal execution creates unclear lifecycle and refresh
semantics:

| Risk | Why it matters |
|:-----|:---------------|
| Render recursion | A generated SQLSeal block could trigger another SQLSeal render pass inside the first render. |
| Watcher ambiguity | Nested processors would register refresh observers with generated, not source-authored, context. |
| REST side effects | `/sqlseal/query` rendering should not execute arbitrary nested SQLSeal blocks as a side effect. |
| Debuggability | Errors would come from generated markdown that is not present in the source file. |

Renderer behavior:

- Reject generated markdown containing fenced `sqlseal` blocks: ```` ```sqlseal ```` or `~~~sqlseal`.
- Show a clear renderer error explaining that nested SQLSeal blocks are not supported in `MARKDOWN` output.
- Recommend `sql`, `md`, or escaped fences when the user wants to display query examples.

## Implementation Notes

`RendererContext` should carry enough lifecycle information for Obsidian's
renderer:

```ts
interface RendererContext {
  cellParser?: ModernCellParser;
  sourcePath: string;
  app: App;
  component: Component;
}
```

`CodeblockProcessor` already extends `MarkdownRenderChild`, so it can pass
itself as the render component:

```ts
this.rendererRegistry.prepareRender(type, options)(rendererEl, {
  cellParser: this.cellParser,
  sourcePath: this.sourceKey,
  app: this.app,
  component: this,
});
```

Renderer output becomes async because Obsidian markdown rendering is async:

```ts
interface RenderReturn {
  render: (data: any) => void | Promise<void>;
  error: (errorMessage: string) => void;
  cleanup?: () => void;
}
```

`CodeblockProcessor.render()` and the REST endpoint should await renderer
output.

## Compatibility

`TEMPLATE` remains the raw HTML/Nunjucks renderer. Existing HTML templates keep
working and remain appropriate when callers want precise HTML table layout.

`MARKDOWN` changes meaning in the fork. The old behavior is intentionally
deprecated because it is not useful as a presentation mode. Mention the behavior
change in the fork changelog when implementing.

## Tests

Add or update tests for:

| Test | Assertion |
|:-----|:----------|
| Native markdown render | `MARKDOWN` calls Obsidian `MarkdownRenderer.render(...)` with generated markdown and source path. |
| Template data | `data`, `columns`, and `properties` are available inside the Nunjucks markdown template. |
| No-template fallback | Default markdown table output is rendered by Obsidian, not inserted as raw text. |
| Nested SQLSeal guard | Generated markdown containing `sqlseal` fences produces a clear renderer error. |
| REST output | `/sqlseal/query` returns rendered `html` for `MARKDOWN` blocks. |
| Lifecycle cleanup | Rendered child components attach to the SQLSeal codeblock processor or equivalent REST component. |

## Archived Alternative

The previous materialization plan lives under
`docs/features/archive/materialize/`. It remains useful historical context for
link-indexing and generated-output tradeoffs, but it is not the active plan.
