# SQLSeal (Fork)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/victor-software-house/sql-seal)

Private fork of [h-sphere/sql-seal](https://github.com/h-sphere/sql-seal). Obsidian plugin for running SQL queries against vault metadata with Nunjucks template rendering.

**Fork changes from upstream:** Nunjucks replaces Handlebars for TEMPLATE mode, `links` global table, `parent`/`depth` columns on `files` table, custom Nunjucks filters (`groupby`, `unique`), VaultLoader for `{% include %}` of `.njk` files.

## Installation

Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) using repo `victor-software-house/sql-seal`.

**Manual:** Download the latest release `.zip` and extract to `.obsidian/plugins/sqlseal/`.

## Technology Stack

| Component | Implementation |
|:----------|:---------------|
| Language | TypeScript, compiled with esbuild |
| SQLite | `@jlongster/sql.js` (WASM), persisted via `absurd-sql` in a Web Worker |
| Templates | [Nunjucks](https://mozilla.github.io/nunjucks/) |
| Grid | ag-grid-community |
| Parser | `ohm-js` (codeblock grammar), `sql-parser-cst` (SQL rewriting) |
| Package manager | pnpm |
| Tests | Jest with ts-jest |

## Global Tables

Four tables are automatically populated from vault metadata:

| Table | Key Columns | Indexed On |
|:------|:------------|:-----------|
| `files` | `path`, `name`, `parent`, `depth`, frontmatter fields | `id`, `name`, `path`, `parent` |
| `tags` | `tag`, `path` | `tag`, `fileId`, `path` |
| `links` | `path` (source), `target` (resolved), `display_text`, `target_exists` | `path`, `target` |
| `tasks` | `path`, `task`, `completed`, `heading` | `filePath` |

The `files` table dynamically adds columns for every frontmatter field encountered in the vault.

## Bind Variables

Every query receives bind variables from the note it appears in. Use `@variableName` in SQL:

| Variable | Value |
|:---------|:------|
| `@path` | Current file path (e.g., `Projects/Maximus/Maximus.md`) |
| `@fileName` | Filename with extension |
| `@basename` | Filename without extension |
| `@parent` | Parent directory path |
| `@extension` | File extension |
| `@title`, `@scope`, ... | Any frontmatter field from the current file |

In Nunjucks templates, the same values are available as `{{ properties.path }}`, `{{ properties.scope }}`, etc.

### Example: Siblings of the Current Note

````markdown
```sqlseal
TEMPLATE
{% include "_templates/children-table.njk" %}

SELECT a(path, COALESCE(title, name)) as note, description
FROM files
WHERE parent = @parent AND path != @path AND name != @basename
ORDER BY COALESCE("order", 999), name
```
````

### Example: Backlinks to the Current Note

````markdown
```sqlseal
TEMPLATE
{% include "_templates/related-links.njk" %}

SELECT DISTINCT a(f.path, COALESCE(f.title, f.name)) as link, f.description
FROM links l
JOIN files f ON f.path = l.path
WHERE l.target = @path
ORDER BY f.name
```
````

### Example: Notes Sharing the Same Scope

````markdown
```sqlseal
GRID
SELECT a(path, COALESCE(title, name)) as note, note_type, description
FROM files
WHERE scope = @scope AND path != @path
ORDER BY note_type, name
```
````

## Render Modes

| Mode | Use When |
|:-----|:---------|
| `TEMPLATE` | Full control via Nunjucks templates (preferred) |
| `GRID` | Sortable, paginated ag-grid tables |
| `MARKDOWN` | ASCII table output (copyable) |
| `LIST` | Simple `ul`/`li` elements |
| `HTML` | Basic HTML table |

### TEMPLATE Mode

Uses [Nunjucks](https://mozilla.github.io/nunjucks/) (not Handlebars). Templates can be inline or loaded from vault `.njk` files via `{% include %}`.

**Available in template context:**

| Variable | Content |
|:---------|:--------|
| `data` | Array of query result rows (with `a()` links pre-rendered as SafeString) |
| `columns` | Array of column names |
| `properties` | Current file metadata (path, parent, basename, frontmatter) |

**Custom filters:** `groupby(key)`, `unique(key?)`.

**VaultLoader:** `.njk` files anywhere in the vault are available via `{% include "path/to/template.njk" %}`.

## CSV and SQLite Support

```sql
TABLE transactions = file(transactions.csv)
SELECT * FROM transactions LIMIT 10
```

Tables from CSV files are local to the note. `.sql`, `.sqlseal`, and `.sqlite` files can be opened directly in the SQLSeal file viewer.

## Inline Queries

Use `` `S> SELECT COUNT(*) FROM files` `` for inline values within text.

## Architecture Overview

```
src/
  main.ts                     -- plugin entry, DI container setup
  modules/
    main/                     -- plugin lifecycle and module wiring
    database/                 -- SqlSealDatabase (Comlink) + WorkerDatabase (Web Worker, absurd-sql)
    sync/                     -- vault file watching, global table population, CSV/file sync
    editor/
      codeblockHandler/       -- codeblock rendering pipeline, inline S> queries
      renderer/               -- TEMPLATE, GRID, MARKDOWN, LIST, HTML renderers + VaultLoader
      sql/                    -- SQL rewriting (table name mapping, @param support)
      parser.ts               -- OHM grammar for codeblock parsing
    explorer/                 -- .sql/.sqlseal/.sqlite file viewer
    settings/                 -- plugin settings UI
    api/                      -- public API for other plugins
    syntaxHighlight/          -- CodeMirror syntax + cell parsing
```

For detailed schema, rendering pipeline, and coding conventions, see [AGENTS.md](./AGENTS.md).

## Local Development

```bash
pnpm install
pnpm run dev          # watch mode (esbuild)
pnpm run build        # production build
pnpm run typecheck    # tsc --noEmit
pnpm test             # jest
```

Output: `main.js`, `styles.css` in repo root. Copy to `.obsidian/plugins/sqlseal/` or use BRAT for auto-install from the fork repo.

## CI and Release

| Workflow | Trigger | Action |
|:---------|:--------|:-------|
| `test.yml` | Pull request to `main` | Runs `pnpm test` and `pnpm run typecheck` |
| `release.yml` | Push to `main` | Builds, runs changesets action, tags and publishes GitHub release with `main.js`, `manifest.json`, `styles.css` |
| `docs.yml` | Push to `main` | Builds VitePress docs and deploys to FTP |

Releases use [changesets](https://github.com/changesets/changesets). Version bumps go through `pnpm run ci:version` and publishing through `scripts/tag-and-publish.sh`.

## Disclaimer

The plugin authors do not take any responsibility for any potential data loss. Always backup your files before usage. This plugin may modify files in your vault in the following situations (the list might not be exhaustive):

- **.sql and .sqlseal files**: Variable values are saved as comments at the end of these files
- **Markdown files**: When interacting with tasks using the `tasks` table, the plugin will update source markdown files

## Related

- Upstream documentation: [hypersphere.blog/sql-seal](https://hypersphere.blog/sql-seal)
- Upstream repository: [h-sphere/sql-seal](https://github.com/h-sphere/sql-seal)
