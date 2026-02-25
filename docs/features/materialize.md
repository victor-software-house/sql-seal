# Feature: MATERIALIZE Mode

Comment-stored queries with native markdown output. Eliminates the codeblock in favor of HTML comment markers, producing real wikilinks and agent-readable content.

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

The `a(path, title)` SQL function is executed as a custom SQL function (same as today). During serialization, `LinkParser.renderAsString()` converts the output to `[[path|title]]` wikilink syntax instead of `<a>` HTML tags.

### Bind Variables

Same as current TEMPLATE mode. The plugin reads the file's frontmatter via `metadataCache.getFileCache(file)` and provides all fields as bind variables:

- `@path`, `@parent`, `@basename`, `@scope`, `@note_type`, `@title`
- All frontmatter fields

### Output Serialization

The serialization pipeline reuses existing infrastructure:

1. `db.select(transformedQuery, variables)` returns `{ data, columns }` (same as `CodeblockProcessor.render()`)
2. `ParseResults.renderAsString(data, columns)` converts all cells through `cellParser.renderAsString()`, which calls `LinkParser.renderAsString()` for link cells, producing `[[path|title]]`
3. `getMarkdownTable()` (from [`markdown-table-ts`](https://github.com/nicgirault/markdown-table-ts), already a dependency) formats the result as a markdown table
4. The table string is written between the markers via [`vault.process()`](https://docs.obsidian.md/Reference/TypeScript+API/Vault/process)

### Liveness

The existing reactive mechanism in `CodeblockProcessor` uses the [`@hypersphere/omnibus`](https://www.npmjs.com/package/@hypersphere/omnibus) event bus to re-render when underlying tables change. MATERIALIZE uses the same approach:

1. On plugin load, scan all open files for `<!-- sqlseal: ... -->` markers
2. Parse the SQL query from each marker
3. Execute the query, serialize results, compare with existing content
4. Subscribe to table change events (`registerObservers`) for the tables referenced by the query
5. On change, re-execute, re-serialize, and write if content differs (idempotent)

#### Debounce and Idempotency

- **Content comparison:** Before writing, compare new output with existing content between markers. Skip write if identical.
- **Debounce:** Minimum 2-second delay between writes to the same file to avoid rapid-fire I/O during bulk vault changes.
- **Write coalescing:** If multiple MATERIALIZE blocks exist in one file, batch all updates into a single `vault.process()` call.

### Editing the Query

Three tiers of edit UX, from simplest to most polished:

#### Tier 1: Source View (No Plugin Work)

Users can always switch to source view and edit the HTML comment directly. The query is plain text.

#### Tier 2: Hover Edit Button

In live preview, the plugin injects a small pencil icon ([CodeMirror 6 widget decoration](https://codemirror.net/docs/ref/#view.WidgetType)) near the materialized block. Clicking it opens a modal with:

- A text area containing the SQL query (syntax-highlighted if possible)
- A "Run" button to preview results
- A "Save" button that writes the updated query back into the comment

Prior art: [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer)'s inline refresh button, [Meta Bind](https://github.com/mProjectsCode/obsidian-meta-bind-plugin)'s input field widgets.

#### Tier 3: Click-to-Reveal (Future)

Same pattern Obsidian uses for `**bold**`, `[[links]]`, and math blocks in live preview. Click into the materialized region and the raw comment + markdown source appears. Click away and it collapses back to rendered output. This requires a [CodeMirror 6](https://codemirror.net/docs/guide/) `ViewPlugin` with [`Decoration.replace`](https://codemirror.net/docs/ref/#view.Decoration%5Ereplace).

---

## CLI Companion

A standalone script that materializes queries outside of Obsidian. Written in TypeScript, runs via `bun`.

### Vault Indexing

The CLI builds an in-memory SQLite database (via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)) with the same four tables SQLSeal populates inside Obsidian:

| Table | Columns | Source |
|:------|:--------|:-------|
| `files` | `id, path, name, parent, depth, created_at, modified_at, file_size` + all frontmatter fields | Walk `.md` files, parse frontmatter with [`gray-matter`](https://github.com/jonschlinkert/gray-matter) |
| `tags` | `tag, fileId, path` | Extract `tags` from frontmatter + inline `#tags` via regex |
| `links` | `path, target, display_text, target_exists` | Parse `[[...]]` patterns from file body text |
| `tasks` | `path, task, completed, position, heading, heading_level` | Parse `- [ ]` / `- [x]` patterns |

### Query Execution

1. Find all `<!-- sqlseal: ... -->` markers in `.md` files
2. Parse the SQL query from each marker
3. Resolve bind variables from the file's frontmatter
4. Register `a()` as a custom SQL function that returns `[[arg1|arg2]]` (matching `LinkParser.renderAsString`)
5. Execute the query against the local SQLite DB
6. Serialize results as a markdown table using the same `getMarkdownTable()` format
7. Compare with existing content between markers
8. Write if different, update timestamp

### Drift Mitigation

The CLI and plugin must produce **byte-identical output** for the same query and data. Both use:

- Same SQL function signatures (`a()` with 2 args)
- Same `renderAsString` logic (`[[path|title]]` for internal links, `[name](url)` for external)
- Same `getMarkdownTable()` formatter (from [`markdown-table-ts`](https://github.com/nicgirault/markdown-table-ts))
- Same column ordering (determined by the SQL `SELECT` clause)

To validate parity: the CLI can run in `--check` mode, which reports any files where the CLI output differs from the existing materialized content without writing.

### Usage

```bash
# Materialize all queries in the vault
sqlseal-cli materialize /path/to/vault

# Materialize a single file
sqlseal-cli materialize /path/to/vault/Projects/Body\ AI\ Corp/Body\ AI\ Corp.md

# Check for stale materializations without writing
sqlseal-cli check /path/to/vault

# Report files with materializations older than 24 hours
sqlseal-cli stale /path/to/vault --threshold 24h
```

---

## Comparison with Prior Art

| Dimension | [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer) | [Text Expand](https://github.com/mrjackphil/obsidian-text-expand) | Current SQLSeal (TEMPLATE) | **SQLSeal MATERIALIZE** |
|:----------|:-------------------|:------------|:--------------------------|:------------------------|
| Query location | HTML comment | `expander` codeblock | `sqlseal` codeblock | HTML comment |
| Query language | DQL | Obsidian search | SQL | SQL |
| Output format | Markdown | Markdown | HTML (DOM injection) | Markdown |
| Wikilinks in file | Yes | Yes | No | Yes |
| Graph / backlinks | Yes | Yes | No | Yes |
| Auto-rename | Yes | Yes | No | Yes |
| Liveness | On save (5s debounce) | Manual | Reactive (event bus) | Reactive (event bus) |
| Nunjucks templates | No | No | Yes | No (markdown table only) |
| CLI companion | No | No | No | Yes |
| Timestamp | No | No | No | Yes |
| Edit UX | Edit comment in source view | Edit codeblock | Edit codeblock | Hover button / modal |
| `--` in queries | Forbidden (HTML comment) | N/A | Allowed | See Encoding section |

### HTML Comment `--` Restriction

HTML comments cannot contain `--` (double hyphen). SQL queries may use `--` for comments or `--` can appear in string literals. Two mitigations:

1. **Encoding:** Replace `--` with a sentinel (e.g., `&#45;&#45;`) inside the comment. The plugin and CLI decode before execution.
2. **External file import:** Use `<!-- sqlseal-file: _queries/complex.sql -->` for queries that contain `--`.

---

## Migration Path

### From TEMPLATE to MATERIALIZE

For each existing `sqlseal` codeblock with TEMPLATE:

1. Extract the SQL query (strip the `TEMPLATE` directive and Nunjucks template)
2. Wrap it in `<!-- sqlseal: <SQL> -->`
3. Execute the query and serialize results as a markdown table
4. Place the full marker block where the codeblock was
5. Delete the codeblock

A migration command (`SQLSeal: Migrate TEMPLATE to MATERIALIZE`) can automate this for all files or the current file.

### Backward Compatibility

TEMPLATE mode continues to work unchanged. MATERIALIZE is additive. Users can mix both modes in the same vault. The migration is opt-in per query.

---

## Implementation Scope

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Comment marker parser | ~1 day | New: `src/modules/editor/materialize/markerParser.ts` |
| Materializer (query + serialize + write) | ~2 days | New: `src/modules/editor/materialize/materializer.ts`. Reuses `db.select()`, `ParseResults.renderAsString()`, `getMarkdownTable()` |
| File watcher integration | ~1 day | Extends `SealFileSync` or adds new listener. Reuses `Omnibus` event bus |
| Idempotency + debounce | ~0.5 day | Part of materializer |
| Hover edit button (Tier 2) | ~1.5 days | New: `src/modules/editor/materialize/editWidget.ts`. CodeMirror 6 widget + modal |
| CLI companion | ~3 days | New package: `packages/cli/`. [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), [`gray-matter`](https://github.com/jonschlinkert/gray-matter), [`markdown-table-ts`](https://github.com/nicgirault/markdown-table-ts) |
| Migration command | ~1 day | New command in plugin |
| Tests | ~2 days | Marker parser, serialization parity, idempotency, `--` encoding |
| **Total** | **~12 days** | |

---

## Open Questions

1. **Should MATERIALIZE blocks also render in Obsidian's reading view via a post-processor?** The native markdown table is already rendered by Obsidian, so no post-processing is needed for display. But a post-processor could add the hover edit button and hide the comment markers more cleanly.

2. **Should the timestamp also go into frontmatter?** A file-level `sqlseal_materialized_at` field would enable vault-wide staleness queries via SQL. But it adds frontmatter noise.

3. **Multi-line query encoding:** The `--` restriction in HTML comments is a real constraint. Should we default to external `.sql` file import for complex queries, or invest in the encoding approach?

4. **Should MATERIALIZE support non-table output?** The current design outputs markdown tables only. Lists (`- [[link]]`) or definition lists could be useful for some sections (e.g., Related).
