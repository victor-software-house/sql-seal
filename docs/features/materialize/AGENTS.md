# AGENTS — MATERIALIZE Feature

Context for AI agents working on the MATERIALIZE mode implementation.

---

## What This Feature Does

MATERIALIZE writes SQL query results as native markdown directly into vault files, using HTML comment markers to store the query and delimit the output. Unlike TEMPLATE mode (which injects HTML into a codeblock's DOM at render time), MATERIALIZE produces real `[[wikilinks]]` that Obsidian indexes for graph, backlinks, and auto-rename.

---

## Key Files (Existing)

| File | Role |
|:-----|:-----|
| `src/modules/editor/codeblockHandler/CodeblockProcessor.ts` | Current codeblock rendering pipeline. MATERIALIZE reuses the query execution path (`transformQuery()` + `db.select()`) but bypasses the renderer registry. |
| `src/modules/syntaxHighlight/cellParser/parser/link.ts` | `LinkParser.renderAsString()` converts `a()` output to `[[path\|title]]`. This is the serialization function MATERIALIZE calls. |
| `src/modules/syntaxHighlight/cellParser/parseResults.ts` | `ParseResults.renderAsString()` iterates all cells through `cellParser.renderAsString()`. MATERIALIZE uses this directly. |
| `src/modules/syntaxHighlight/cellParser/ModernCellParser.ts` | `renderAsString()` dispatches to the correct parser (link, image, checkbox). Also registers SQL functions via `registerDbFunctions()`. |
| `src/modules/syntaxHighlight/cellParser/factory.ts` | `cellParserFactory()` wires up `LinkParser`, `ImageParser`, `CheckboxParser` and registers them as SQL functions on the database. |
| `src/modules/editor/sql/sqlTransformer.ts` | `transformQuery()` rewrites table names and extracts referenced tables for observer registration. |
| `src/utils/registerObservers.ts` | `registerObservers()` subscribes to `change::<table>` and `file::change::<path>` events on the Omnibus bus. |
| `src/modules/sync/fileSyncController/FileSync.ts` | `SealFileSync` listens to `vault.on('modify'/'create'/'delete'/'rename')` and re-indexes all table plugins, then triggers bus events. |
| `src/modules/sync/sync/tables/` | `FilesFileSyncTable`, `TagsFileSyncTable`, `LinksFileSyncTable`, `TasksFileSyncTable` — the four global table indexers. |
| `src/modules/sync/sync/sync.ts` | `Sync` class owns the Omnibus bus and exposes `triggerGlobalTableChange()`. |

## Key Files (New — To Be Created)

| File | Role |
|:-----|:-----|
| `src/modules/editor/materialize/markerParser.ts` | Parse `<!-- sqlseal: ... -->` markers from file content. Shared with CLI via `packages/shared/`. |
| `src/modules/editor/materialize/serializer.ts` | Format query results as markdown table or list. Uses `ParseResults.renderAsString()` + `getMarkdownTable()`. |
| `src/modules/editor/materialize/materializer.ts` | Orchestrate: parse markers, execute queries, serialize, compare, write via `vault.process()`. |
| `src/modules/editor/materialize/writeLock.ts` | `MaterializeWriteLock` — file-level write suppression to prevent infinite loops. |
| `src/modules/editor/materialize/editWidget.ts` | Tier 2 edit UX: `registerMarkdownPostProcessor` + `Modal` for query editing. |
| `src/modules/editor/materialize/migrateCommand.ts` | Command to convert TEMPLATE codeblocks to MATERIALIZE comment blocks. |
| `packages/shared/` | Shared marker parser, table formatter, link serializer — used by both plugin and CLI. |
| `packages/cli/` | Standalone CLI materializer with `better-sqlite3`, `gray-matter`. |

---

## Critical Constraint: Infinite Loop Prevention

When the materializer writes to a file, `vault.on('modify')` fires, which re-indexes the file in `SealFileSync`, which triggers bus events, which re-triggers the materializer. Three layers prevent infinite loops:

1. **Idempotency:** Compare new output with existing content. Skip write if byte-identical.
2. **Write lock:** After writing, suppress re-materialization of the same file for 500ms.
3. **Global debounce:** Minimum 2-second delay between materialization passes.

See [implementation.md](./implementation.md) for full details.

---

## Marker Format

```markdown
<!-- sqlseal: <SQL query> -->
<!-- sqlseal-updated: <ISO 8601 timestamp> -->
<native markdown output (tables, lists)>
<!-- /sqlseal -->
```

Variants: `<!-- sqlseal-list: ... -->` for list output, `<!-- sqlseal-file: path.sql -->` for external query files.

The `--` inside HTML comments is invalid per HTML spec. Queries containing `--` must use `&#45;&#45;` encoding (transparent via edit modal) or external `.sql` files.

---

## Serialization Pipeline

```
markerParser.parseMaterializeBlocks(fileContent)
    → materializer.materialize(block, db, cellParser)
        → transformQuery(block.query, tableMapping)
        → db.select(transformedQuery, variables)
        → ParseResults.renderAsString(data, columns)
        → formatMarkdownTable(stringData, columns) | formatList(stringData, columns)
        → compare with block.currentContent
        → if different: vault.process(file, content => replaceBlock(content, block, newOutput))
```

---

## Dependencies

| Package | Used For |
|:--------|:---------|
| [`@hypersphere/omnibus`](https://www.npmjs.com/package/@hypersphere/omnibus) | Event bus for reactive updates |
| [`markdown-table-ts`](https://github.com/nicgirault/markdown-table-ts) | Markdown table formatting |
| [`@codemirror/language`](https://codemirror.net/docs/ref/#language) | SQL syntax highlighting in edit modal |
| [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | CLI companion — in-memory SQLite |
| [`gray-matter`](https://github.com/jonschlinkert/gray-matter) | CLI companion — YAML frontmatter parsing |

---

## Plan Documents

| Document | Contents |
|:---------|:---------|
| [README.md](./README.md) | Overview, motivation, file format, wikilink mechanics |
| [implementation.md](./implementation.md) | Marker parser, serialization, liveness/anti-loop |
| [edit-ux.md](./edit-ux.md) | Three tiers of query editing |
| [cli-companion.md](./cli-companion.md) | CLI architecture, vault indexing, CI integration |
| [examples.md](./examples.md) | Before/after for all section types |
| [prior-art.md](./prior-art.md) | Comparison table, HTML `--` restriction |
| [migration.md](./migration.md) | TEMPLATE to MATERIALIZE migration |
| [scope.md](./scope.md) | Phased plan (18d), resolved decisions, open questions |
