# AGENTS

Shared coding and review standards for all automation working on this repository.

For project overview, installation, and usage, see [README.md](./README.md).
For the active fork implementation direction, see [PLAN.md](./PLAN.md).

---

## Project Identity

| Field | Value |
|:------|:------|
| Upstream | `h-sphere/sql-seal` |
| Fork org | `victor-software-house` |
| Distribution | BRAT (`victor-software-house/sql-seal`) |
| Package manager | pnpm |
| Build | esbuild (`pnpm run build`) |
| Test | Jest (`pnpm test`) |
| Typecheck | `pnpm run typecheck` |

---

## Validation Requirements

Run before committing or finalizing any change:

```bash
pnpm run typecheck && pnpm test
```

CI runs both on every pull request to `main` (see `.github/workflows/test.yml`).

- `typecheck` = `tsc -noEmit -skipLibCheck`
- `test` = `jest` (ts-jest, node environment)
- Build = `pnpm run build` (esbuild, produces `main.js` + `styles.css`)

---

## Release Requirements

This fork is distributed through BRAT from `victor-software-house/sql-seal`.
Release work must leave a GitHub release with the built plugin assets attached.

- Use Changesets as the release source of truth. Feature/fix PRs that should
  ship must include a `.changeset/*.md` file.
- Releases are gated by explicit human intervention: the release workflow opens
  or updates a version PR from pending changesets, and publishing happens only
  after a human merges that release PR into `main`.
- Do not publish directly from a feature PR, local workstation, or manual tag
  unless the user explicitly requests an emergency release path.
- Always bump at patch level only unless the user explicitly requests a
  different semantic version change in the current task.
- Use `pnpm pkg set version=<next-patch> && pnpm run version` so
  `package.json`, `manifest.json`, and `versions.json` stay aligned for manual
  emergency releases. In the normal automated path, `pnpm run ci:version`
  performs this alignment inside the Changesets release PR.
- Update `CHANGELOG.md` for user-visible behavior changes before tagging.
- Run `pnpm run typecheck`, `pnpm test --runInBand`, and `pnpm run build`
  before publishing a code release.
- The release workflow must run typecheck, tests, and production build before it
  opens/updates the release PR or publishes the merged release.
- Commit and push manual release changes before creating the tag or GitHub
  release.
- Attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release so
  BRAT can update installed vaults on restart.

---

## Architecture Reference

### Module Map

| Module | Responsibility |
|:-------|:---------------|
| `src/main.ts` | Plugin entry point, DI container setup via `@hypersphere/dity` |
| `modules/main/` | Plugin lifecycle, module wiring |
| `modules/database/` | `SqlSealDatabase` (Comlink wrapper) + `WorkerDatabase` (Web Worker, absurd-sql) |
| `modules/sync/` | Vault file watching, global table population (`files`, `tags`, `links`, `tasks`), CSV/file sync |
| `modules/editor/codeblockHandler/` | Codeblock rendering pipeline (`CodeblockProcessor`), inline `S>` query handler |
| `modules/editor/renderer/` | Renderer registry + implementations: `TemplateRenderer`, `GridRenderer`, `MarkdownRenderer`, `ListRenderer`, `TableRenderer`, `VaultLoader` |
| `modules/editor/sql/` | SQL rewriting via `sqlTransformer` (table name mapping, `@param` support) |
| `modules/editor/parser.ts` | OHM grammar for codeblock parsing |
| `modules/explorer/` | `.sql`/`.sqlseal`/`.sqlite` file viewer |
| `modules/settings/` | Plugin settings UI |
| `modules/api/` | Public API for other plugins |
| `modules/syntaxHighlight/` | CodeMirror syntax highlighting + cell parsing |

### Rendering Pipeline

1. Obsidian registers `sqlseal` code block processor
2. `CodeblockProcessor.onload()` parses source via OHM grammar
3. Renderer type extracted (TEMPLATE, GRID, MARKDOWN, LIST, HTML)
4. SQL query transformed (table name mapping via `sqlTransformer`)
5. Bind variables built from current file metadata + frontmatter
6. Query executed against WorkerDatabase
7. Results passed to renderer with `{ data, columns, frontmatter }`
8. For TEMPLATE: Nunjucks compiles template string, renders with `{ data, columns, properties }`

### Active Renderer Plan

The current `MARKDOWN` renderer is deprecated raw-text table output. The active
plan is to replace it with native Obsidian-rendered markdown using Nunjucks and
`MarkdownRenderer.render(...)`. See `PLAN.md` and
`docs/features/native-markdown-renderer/README.md`. Do not revive the archived
materialization plan under `docs/features/archive/materialize/` unless a newer
decision explicitly says so.

### Global Tables Schema

#### `files`

All markdown files. Frontmatter fields become columns dynamically.

| Column | Source | Notes |
|:-------|:-------|:------|
| `id` | `file.path` | Primary key, same as `path` |
| `path` | `file.path` | Full path including `.md` extension |
| `name` | `file.basename` | Filename without extension |
| `parent` | `file.parent?.path` | Parent directory path |
| `depth` | path segment count | Number of `/`-separated segments |
| `created_at` | `file.stat.ctime` | ISO timestamp |
| `modified_at` | `file.stat.mtime` | ISO timestamp |
| `file_size` | `file.stat.size` | Bytes |
| *(frontmatter)* | metadata cache | Every frontmatter key becomes a column |

Indexed on: `id`, `name`, `path`, `parent`.

#### `tags`

| Column | Source |
|:-------|:-------|
| `tag` | Tag string (e.g., `#architecture`) |
| `fileId` | File path |
| `path` | File path (same as fileId) |

#### `links`

Outgoing wikilinks from each file, resolved against vault.

| Column | Source |
|:-------|:-------|
| `path` | Source file path (file containing the link) |
| `target` | Resolved target file path |
| `display_text` | Link display text |
| `target_exists` | Boolean (1/0) whether target resolves |
| `position` | JSON position data |

Indexed on: `path`, `target`.

#### `tasks`

Checkbox items from markdown files.

| Column | Source |
|:-------|:-------|
| `path` | File path |
| `filePath` | File path (same as path) |
| `task` | Task text content |
| `completed` | 1 if checked, 0 if not |
| `position` | Line number |
| `heading` | Parent heading text |
| `heading_level` | Parent heading level |
| `checkbox` | Interactive checkbox (custom cell) |

### Bind Variables

Variables are built in `CodeblockProcessor.render()` and passed to `WorkerDatabase.select()` where they become SQLite `@name` bind parameters via `recordToBindParams()`.

| Variable | Value |
|:---------|:------|
| `@path` | Current file's full path |
| `@fileName` | Filename with extension |
| `@basename` | Filename without extension |
| `@parent` | Parent directory path |
| `@extension` | File extension |
| *(frontmatter)* | Any frontmatter field as `@fieldName` |

In Nunjucks templates: `{{ properties.path }}`, `{{ properties.parent }}`, etc.

### SQL Features

- **Dialect:** SQLite (via `@jlongster/sql.js` WASM, absurd-sql persistence)
- **Parameters:** `@name` syntax (e.g., `WHERE path = @path`)
- **Custom functions:** `a(path, displayText)` creates clickable internal links
- **Recursive CTEs:** Supported (`WITH RECURSIVE`)
- **Parser:** `sql-parser-cst` with `paramTypes: ['@name']`

---

## Coding Standards

- Nunjucks for all template rendering (not Handlebars)
- `VaultLoader` loads `.njk` files from vault for `{% include %}` support
- Custom Nunjucks filters: `groupby`, `unique` (registered on the environment)
- `ParseResults` processes custom cell types (links, checkboxes) before template rendering
- Dynamic updates: queries re-execute on vault changes via the `@hypersphere/omnibus` event bus (when enabled in settings)
- No comments in code unless explicitly requested
- Keep changes minimal and focused

---

## Commit Conventions

- No assistant, model, or vendor names in commit messages or committed files
- Validate before committing: `pnpm run typecheck && pnpm test`

---

## Safety Rules

- Never commit secrets, API keys, or tokens
- The plugin modifies vault files in two cases:
  - `.sql`/`.sqlseal` files: variable values saved as comments
  - Markdown files: task checkbox state updates via `tasks` table
- Test any change that touches `sync/` or `database/` modules against data integrity

---

## Directory Ownership

| Directory | Owner |
|:----------|:------|
| `.claude/` | Claude Code |
| `.windsurf/` | Windsurf/Cascade |
| `.cognition/` | Devin CLI |
| `AGENTS.md` | Shared (all agents) |

Each agent must not read, write, or index directories owned by other agents. Isolation is enforced via agent-native deny rules (see respective config files).
