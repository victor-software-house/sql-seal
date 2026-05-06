# Markdown Renderer
Status: deprecated current behavior.

The current `MARKDOWN` renderer displays a raw text markdown table. It can be
helpful for copy/export, but Obsidian does not parse the generated markdown, so
links, tables, headings, callouts, and embeds do not behave like normal
Obsidian-rendered markdown.

This behavior is planned to be replaced by native Obsidian-rendered markdown.
See the repository root `PLAN.md` and
`docs/features/native-markdown-renderer/README.md`.

```sqlseal

MARKDOWN
SELECT * FROM files LIMIT 10
```

Please note that functions like `img` and `a` do not work well with the current
deprecated renderer because the output is inserted as raw text.
