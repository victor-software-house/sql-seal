# Edit UX

Three tiers of query editing for MATERIALIZE blocks, from simplest to most polished.

---

## Tier 1: Source View (No Plugin Work)

Users can always switch to source view and edit the HTML comment directly. The query is plain text.

---

## Tier 2: Hover Edit Button

In live preview, the plugin registers a [`registerMarkdownPostProcessor`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerMarkdownPostProcessor) that detects materialized regions in the rendered document. Since HTML comments are stripped from the DOM, the post-processor identifies materialized tables by looking for the preceding comment in the raw section info (`context.getSectionInfo()`) and injects a small edit button widget.

Clicking the button opens an Obsidian [`Modal`](https://docs.obsidian.md/Reference/TypeScript+API/Modal) with:

- A `<textarea>` containing the SQL query (syntax-highlighted via [`@codemirror/language`](https://codemirror.net/docs/ref/#language), already a dependency)
- A "Run" button to preview results in a table below
- A "Save" button that writes the updated query back into the comment via `vault.process()`
- A "Cancel" button

The modal can also show bind variable values (read from the file's frontmatter) for debugging.

Prior art: [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer)'s inline refresh button, [Meta Bind](https://github.com/mProjectsCode/obsidian-meta-bind-plugin)'s input field widgets.

---

## Tier 3: Click-to-Reveal (Future)

Same pattern Obsidian uses for `**bold**`, `[[links]]`, and math blocks in live preview. Click into the materialized region and the raw comment + markdown source appears. Click away and it collapses back to rendered output. This requires a [CodeMirror 6](https://codemirror.net/docs/guide/) `ViewPlugin` with [`Decoration.replace`](https://codemirror.net/docs/ref/#view.Decoration%5Ereplace).

This tier is complex because it requires mapping between the CodeMirror document model and the rendered DOM. Deferred to a later release.
