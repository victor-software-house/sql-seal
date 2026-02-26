# Feature: MATERIALIZE Mode

Comment-stored queries with native markdown output. Eliminates the codeblock in favor of HTML comment markers, producing real wikilinks and agent-readable content.

## Documents

| Document | Contents |
|:---------|:---------|
| [Implementation Details](./implementation.md) | Marker parser, serialization pipeline, liveness and anti-loop strategy |
| [Edit UX](./edit-ux.md) | Three tiers of query editing (source view, hover button, click-to-reveal) |
| [CLI Companion](./cli-companion.md) | Standalone materializer, vault indexing, shared code, CI integration |
| [Examples](./examples.md) | Before/after comparisons for Children, Canonical Sources, Related, Siblings |
| [Prior Art](./prior-art.md) | Comparison with Dataview Serializer and Text Expand, HTML `--` restriction |
| [Migration](./migration.md) | TEMPLATE to MATERIALIZE migration path, template mapping |
| [Scope](./scope.md) | Phased implementation plan, resolved decisions, open questions |

---

## Motivation

SQLSeal's current TEMPLATE renderer injects HTML into a codeblock's DOM at render time. This has three structural limitations:

1. **No wikilinks in the file.** The `a()` helper produces `<a>` tags at render time. Obsidian's [link parser](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache) only scans raw file text for `[[...]]` patterns, so dynamically rendered links never enter `metadataCache.links`, `resolvedLinks`, the graph, backlinks, or auto-rename.

2. **Opaque to external tools.** Agents, git diffs, grep, and plain text editors see only the codeblock source. The rendered output is ephemeral.

3. **No CLI path.** The rendering pipeline requires Obsidian's DOM and metadataCache. There's no way to produce output outside of Obsidian.

---

## Design

### File Format

The query lives in an HTML comment. The output is native markdown. Both are surrounded by marker comments.

```markdown
## Children

<!-- sqlseal: SELECT a(path, COALESCE(title, name)) as note, COALESCE(description, '') as description FROM files WHERE parent = @parent AND path != @path AND name != @basename ORDER BY COALESCE("order", 999), name -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
| note | description |
|:-----|:------------|
| [[Strategy Canonical]] | Current baseline + evolution |
| [[Action Tracker]] | Active open items |
<!-- /sqlseal -->
```

#### Marker Contract

| Marker | Purpose |
|:-------|:--------|
| `<!-- sqlseal: <SQL> -->` | Query definition. Invisible in reading view. May span multiple lines within the comment. |
| `<!-- sqlseal-updated: <ISO 8601> -->` | Timestamp of last materialization. |
| Everything between `sqlseal-updated` and `/sqlseal` | Native markdown output (tables, lists, etc.). Regular body text, fully parsed by Obsidian. |
| `<!-- /sqlseal -->` | End sentinel. |

#### Multi-line Query

For readability, the query comment can span multiple lines:

```markdown
<!-- sqlseal:
SELECT
  a(path, COALESCE(title, name)) as note,
  COALESCE(description, '') as description
FROM files
WHERE parent = @parent
  AND path != @path
  AND name != @basename
ORDER BY COALESCE("order", 999), name
-->
```

#### External Query Import

As an alternative to inline queries, the SQL can reference an external `.sql` file:

```markdown
<!-- sqlseal-file: _queries/children.sql -->
```

The plugin reads the file content and executes it. The CLI companion does the same.

### Wikilink Mechanics

Wikilinks in the materialized output are **real**. They sit between HTML comment markers, not inside them. Obsidian's parser treats them as regular body text:

- `metadataCache.links` includes them (with position data)
- `resolvedLinks` maps them to target files
- Graph view draws edges for them
- Backlinks pane shows them
- Auto-rename updates them when target files are renamed

The `a(path, title)` SQL function is registered as a custom SQL function via `ModernCellParser.registerDbFunctions()` (see `src/modules/syntaxHighlight/cellParser/factory.ts`). During serialization, `LinkParser.renderAsString()` (see `src/modules/syntaxHighlight/cellParser/parser/link.ts:76-89`) converts `a()` output to wikilink syntax:

```typescript
// LinkParser.renderAsString() — already exists
renderAsString([href, name]: Args): string {
    const res = this.parseLink(href, name)
    if (res.cls == 'internal-link') {
        return name ? `[[${res.href}|${res.name}]]` : `[[${res.href}]]`
    } else {
        return `[${res.name}](${res.href})`
    }
}
```

This is the exact same code path used by the existing MARKDOWN renderer. No new link serialization logic is needed.

### Bind Variables

Same as current TEMPLATE mode. The plugin reads the file's frontmatter via `metadataCache.getFileCache(file)` and builds the variable context (see `CodeblockProcessor.render()` at `src/modules/editor/codeblockHandler/CodeblockProcessor.ts:135-153`):

```typescript
// Existing bind variable resolution — reused as-is
const file = this.app.vault.getFileByPath(sourcePath);
const fileCache = this.app.metadataCache.getFileCache(file);
const variables = {
    ...(fileCache?.frontmatter ?? {}),
    path: file.path,
    fileName: file.name,
    basename: file.basename,
    parent: file.parent?.path,
    extension: file.extension,
};
```

Available bind variables: `@path`, `@parent`, `@basename`, `@fileName`, `@extension`, plus all frontmatter fields (`@scope`, `@note_type`, `@title`, etc.).
