# AGENTS — Native MARKDOWN Renderer

Context for AI agents maintaining the native Obsidian-rendered `MARKDOWN`
renderer.

## Status

This is implemented behavior. The old `MATERIALIZE` plan is archived under
`docs/features/archive/materialize/` and must not be used as the implementation
direction unless explicitly revived.

## Scope

`MARKDOWN` renders generated markdown in memory through Obsidian's
`MarkdownRenderer.render(...)`. It replaced the raw ASCII table behavior. It
must not write generated output back into vault files.

## Key Source Files

| File | Relevance |
|:-----|:----------|
| `src/modules/editor/renderer/MarkdownRenderer.ts` | Nunjucks markdown rendering through Obsidian. |
| `src/modules/editor/renderer/TemplateRenderer.ts` | Reference for directive parsing, Nunjucks environment behavior, and `ParseResults` usage. |
| `src/modules/editor/renderer/rendererRegistry.ts` | Renderer context and async render contract. |
| `src/modules/editor/codeblockHandler/CodeblockProcessor.ts` | Pass source path and lifecycle component to renderers; await async renderer output. |
| `src/modules/api/restApi.ts` | Ensure REST rendering can return `html` from native markdown output using a detached element and component. |
| `src/modules/sync/syncStrategy/MarkdownTableSyncStrategy.ts` | Existing in-repo example of calling Obsidian `MarkdownRenderer.render(...)`. |

## Non-Goals

- Do not implement materialization, guarded comment regions, write locks, or CLI materialization.
- Do not keep the current raw ASCII markdown table behavior under the `MARKDOWN` name.
- Do not support nested `sqlseal` codeblocks in generated markdown for the first implementation.
