# CLI Companion

A standalone script that materializes queries outside of Obsidian. Written in TypeScript, runs via `bun`.

---

## Architecture

```
packages/cli/
  src/
    index.ts           # Entry point, CLI argument parsing
    vault-indexer.ts    # Walk vault, parse frontmatter, build SQLite DB
    marker-parser.ts    # Shared with plugin (or extracted to packages/shared/)
    materializer.ts     # Execute queries, serialize, write
    link-resolver.ts    # Minimal link resolution (shortest-unique-path)
    sql-functions.ts    # Register a(), img(), checkbox() as custom SQL functions
  package.json
  tsconfig.json
```

---

## Shared Code Extraction

The marker parser and serialization logic should be shared between the plugin and CLI. Extract to a shared package:

```
packages/shared/
  src/
    marker-parser.ts     # parseMaterializeBlocks()
    table-formatter.ts   # formatMarkdownTable(), formatList()
    link-serializer.ts   # renderAsString() logic (wikilink + markdown link output)
  package.json
```

Both the plugin (`src/modules/editor/materialize/`) and CLI (`packages/cli/`) import from `@sqlseal/shared`. This guarantees byte-identical output.

---

## Vault Indexing

The CLI builds an in-memory SQLite database (via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)) with the same four tables SQLSeal populates inside Obsidian:

| Table | Columns | Source | Mirrors |
|:------|:--------|:-------|:--------|
| `files` | `id, path, name, parent, depth, created_at, modified_at, file_size` + all frontmatter fields | Walk `.md` files, parse frontmatter with [`gray-matter`](https://github.com/jonschlinkert/gray-matter) | `FilesFileSyncTable` |
| `tags` | `tag, fileId, path` | Extract `tags` from frontmatter + inline `#tags` via regex | `TagsFileSyncTable` |
| `links` | `path, target, display_text, target_exists` | Parse `[[...]]` patterns from file body (excluding code blocks and comments) | `LinksFileSyncTable` |
| `tasks` | `path, task, completed, position, heading, heading_level` | Parse `- [ ]` / `- [x]` patterns | `TasksFileSyncTable` |

The `files` table mirrors `FilesFileSyncTable` from `src/modules/sync/sync/tables/filesTable.ts`. Key difference: the plugin uses `app.metadataCache.getFileCache(file).frontmatter` to extract frontmatter; the CLI uses `gray-matter` to parse YAML from raw file content.

---

## Link Resolution

The plugin resolves links via `app.metadataCache.getFirstLinkpathDest()`, which uses Obsidian's shortest-unique-path algorithm. The CLI must replicate this:

```typescript
function resolveLink(linkText: string, sourcePath: string, allPaths: string[]): string | null {
    // 1. Exact match: linkText matches a path exactly
    // 2. Basename match: linkText matches the basename (without .md) of exactly one file
    // 3. Partial path match: linkText matches the end of exactly one path
    // 4. If ambiguous (multiple matches), return null
}
```

This function is used when populating the `links` table (to fill `target` and `target_exists`) and when the `a()` SQL function resolves its first argument.

---

## Query Execution

1. Find all `<!-- sqlseal: ... -->` markers in `.md` files (using shared `parseMaterializeBlocks()`)
2. Parse the SQL query from each marker
3. Resolve bind variables from the file's frontmatter (parsed via `gray-matter`)
4. Register `a()` as a custom SQL function that returns `SQLSEALCUSTOM({"type":"a","values":["<path>","<name>"]})` (matching the plugin's internal representation). The serializer then calls `renderAsString()` on this, producing `[[path|title]]`.
5. Execute the query against the local SQLite DB
6. Serialize results via shared `formatMarkdownTable()` / `formatList()`
7. Compare with existing content between markers
8. Write if different, update timestamp

---

## Drift Mitigation

The CLI and plugin must produce **byte-identical output** for the same query and data. Both use:

- Same SQL function signatures (`a()` with 2 args, registered via `registerCustomFunction`)
- Same `renderAsString` logic from shared package (`[[path|title]]` for internal links, `[name](url)` for external)
- Same `formatMarkdownTable()` / `formatList()` from shared package
- Same column ordering (determined by the SQL `SELECT` clause)

To validate parity: the CLI can run in `--check` mode, which reports any files where the CLI output differs from the existing materialized content without writing.

---

## Usage

```bash
# Materialize all queries in the vault
sqlseal-cli materialize /path/to/vault

# Materialize a single file
sqlseal-cli materialize /path/to/vault/Projects/Body\ AI\ Corp/Body\ AI\ Corp.md

# Check for stale materializations without writing
sqlseal-cli check /path/to/vault

# Report files with materializations older than 24 hours
sqlseal-cli stale /path/to/vault --threshold 24h

# Dry run: show what would change without writing
sqlseal-cli materialize /path/to/vault --dry-run

# Verbose: show each file and query being processed
sqlseal-cli materialize /path/to/vault --verbose
```

---

## CI / Pre-Commit Integration

The CLI enables automated materialization in CI pipelines:

```yaml
# .github/workflows/materialize.yml
- name: Materialize SQLSeal queries
  run: sqlseal-cli materialize . --check
  # Fails if any materializations are stale
```

```bash
# .git/hooks/pre-commit
sqlseal-cli materialize . --dry-run --quiet || {
    echo "Stale materializations detected. Run: sqlseal-cli materialize ."
    exit 1
}
```
