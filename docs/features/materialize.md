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

---

## Implementation Details

### Marker Parser

New module: `src/modules/editor/materialize/markerParser.ts`

#### Regex Patterns

```typescript
// Match the opening query comment (single-line or multi-line)
const QUERY_MARKER = /<!--\s*sqlseal:\s*([\s\S]*?)\s*-->/;

// Match the external file import variant
const FILE_MARKER = /<!--\s*sqlseal-file:\s*([\S]+)\s*-->/;

// Match the timestamp comment
const UPDATED_MARKER = /<!--\s*sqlseal-updated:\s*([\S]+)\s*-->/;

// Match the end sentinel
const END_MARKER = /<!--\s*\/sqlseal\s*-->/;
```

#### Parsed Block Structure

```typescript
interface MaterializeBlock {
    /** Byte offset of `<!-- sqlseal:` in the file */
    startOffset: number;
    /** Byte offset of the character after `<!-- /sqlseal -->` */
    endOffset: number;
    /** The raw SQL query (decoded if needed) */
    query: string;
    /** External .sql file path, if using sqlseal-file variant */
    queryFile?: string;
    /** ISO 8601 timestamp of last materialization, or null if never materialized */
    updatedAt: string | null;
    /** The current materialized content between markers (may be empty) */
    currentContent: string;
}
```

#### Parser Function

```typescript
function parseMaterializeBlocks(fileContent: string): MaterializeBlock[] {
    // 1. Find all <!-- sqlseal: ... --> or <!-- sqlseal-file: ... --> occurrences
    // 2. For each, find the matching <!-- /sqlseal --> sentinel
    // 3. Extract the query, timestamp, and current content
    // 4. Return array of blocks sorted by startOffset
    // 5. Validate: no overlapping blocks, no unclosed blocks
}
```

#### Edge Cases

| Case | Behavior |
|:-----|:---------|
| No `<!-- /sqlseal -->` sentinel found | Skip block, log warning |
| Multiple blocks in one file | Process all independently, write back in one `vault.process()` call |
| Empty content (first materialization) | Insert table + timestamp between query marker and end sentinel |
| `--` inside query comment | Decode `&#45;&#45;` to `--` before execution (see Encoding section) |
| Nested HTML comments | Not supported by HTML spec. Not a concern. |
| Query comment inside a code block | Regex matches raw text, so this would be a false positive. Mitigation: check that the match offset is not within a fenced code block region. |

#### Code Block Exclusion

The parser must not match `<!-- sqlseal: ... -->` patterns that appear inside fenced code blocks (e.g., in documentation or examples). The parser pre-processes the file to identify all fenced code block regions (triple-backtick boundaries) and excludes matches within those regions.

```typescript
function getFencedCodeBlockRanges(content: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const regex = /^(`{3,}|~{3,})/gm;
    let openFence: { index: number; marker: string } | null = null;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        if (!openFence) {
            openFence = { index: match.index, marker: match[1] };
        } else if (match[1].startsWith(openFence.marker[0]) && match[1].length >= openFence.marker.length) {
            ranges.push([openFence.index, match.index + match[0].length]);
            openFence = null;
        }
    }
    return ranges;
}
```

### Serialization Pipeline

New module: `src/modules/editor/materialize/serializer.ts`

Reuses the existing code path from `CodeblockProcessor.render()` but diverges at the output stage.

#### Existing Code Path (TEMPLATE)

```
parser.ts (ohm-js grammar) → parseWithDefaults()
    → CodeblockProcessor.render()
        → transformQuery() → db.select() → { data, columns }
        → RendererRegistry.prepareRender('template')
            → TemplateRenderer.render()
                → ParseResults.parse() → nunjucks.render() → el.innerHTML = ...
```

#### New Code Path (MATERIALIZE)

```
markerParser.ts → parseMaterializeBlocks()
    → Materializer.materialize()
        → transformQuery() → db.select() → { data, columns }
        → ParseResults.renderAsString(data, columns)
            → cellParser.renderAsString() per cell
                → LinkParser.renderAsString() for a() cells → [[path|title]]
        → formatMarkdownTable(stringData, columns) → markdown string
        → compare with currentContent
        → if different: vault.process() to write new content + timestamp
```

#### Markdown Table Formatting

The project already depends on [`markdown-table-ts`](https://github.com/nicgirault/markdown-table-ts). The formatter function:

```typescript
import { getMarkdownTable } from 'markdown-table-ts';

function formatMarkdownTable(
    data: Record<string, string>[],
    columns: string[]
): string {
    if (data.length === 0) {
        return '*No results*';
    }
    return getMarkdownTable({
        table: {
            head: columns,
            body: data.map(row => columns.map(col => row[col] ?? ''))
        },
        alignment: columns.map(() => 'left')
    });
}
```

#### Output Format Options

MATERIALIZE defaults to table output. Two additional formats for non-tabular sections:

| Format | Directive | Output |
|:-------|:----------|:-------|
| Table (default) | `<!-- sqlseal: ... -->` | Markdown table with `\|` column separators |
| List | `<!-- sqlseal-list: ... -->` | `- [[link]] — description` per row (first column is link, second is description) |
| Plain | `<!-- sqlseal-plain: ... -->` | Raw `renderAsString` output, one row per line |

List format example:

```markdown
<!-- sqlseal-list: SELECT a(path, COALESCE(title, name)) as link, description FROM files WHERE note_type = 'canonical' AND @path LIKE parent || '/%' ORDER BY title -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
- **[[Strategy Canonical|Strategy]]** — Current baseline + evolution
- **[[Action Tracker|Actions]]** — Active open items
- **[[Terminology and Entity Map|Terminology]]** — Define terms once, link everywhere
<!-- /sqlseal -->
```

### Liveness and Write-Back Loop

#### The Infinite Loop Problem

This is the hardest technical challenge. The write-back loop:

1. Data changes in vault (file created/modified/deleted)
2. `SealFileSync` (`src/modules/sync/fileSyncController/FileSync.ts`) re-indexes the affected file via `onFileModify()` on all table plugins (`FilesFileSyncTable`, `TagsFileSyncTable`, `LinksFileSyncTable`, `TasksFileSyncTable`)
3. `SealFileSync.triggerChange()` calls `sync.triggerGlobalTableChange(name)` for each table
4. `bus.trigger('change::files')` fires
5. Materializer receives the event via `registerObservers` callback
6. Materializer re-executes query, serializes, compares, writes if different
7. Writing triggers `vault.on('modify')` — **back to step 2**

If the output hasn't changed, step 6 skips the write and the loop stops. But if the output *has* changed (e.g., a new child file was added), the write in step 6 triggers re-indexing in step 2. The re-indexed file now has new wikilinks (from the materialized table), which changes the `links` table, which fires `change::links`, which may trigger other materializers.

#### Anti-Loop Strategy

Three layers of protection:

**Layer 1: Content Comparison (Idempotency)**

Before writing, compare the new markdown string with the existing content between markers. If byte-identical, skip the write entirely. This stops most loops at step 6.

**Layer 2: File-Level Write Lock**

Maintain a `Map<string, number>` of `filePath → lastWriteTimestamp`. After writing to a file, set the lock. When the `vault.on('modify')` event fires for that file, check if the modification happened within a short window (e.g., 500ms) of the last write. If so, suppress re-materialization for that file.

```typescript
class MaterializeWriteLock {
    private locks = new Map<string, number>();
    private readonly LOCK_DURATION_MS = 500;

    markWritten(path: string) {
        this.locks.set(path, Date.now());
    }

    shouldSuppress(path: string): boolean {
        const lastWrite = this.locks.get(path);
        if (!lastWrite) return false;
        return (Date.now() - lastWrite) < this.LOCK_DURATION_MS;
    }
}
```

**Layer 3: Global Debounce**

Minimum 2-second delay between materialization passes. If multiple table change events fire in rapid succession (common during vault startup or bulk operations), coalesce them into a single pass.

#### Integration with SealFileSync

The materializer does NOT register as an `AFileSyncTable` plugin. It operates at a different layer. Instead:

1. The materializer subscribes to `change::files`, `change::links`, `change::tags`, `change::tasks` events on the Omnibus bus
2. When any global table changes, it re-evaluates all active materialize blocks
3. It uses `vault.process()` (atomic read-modify-write) to update files
4. The write lock prevents the resulting `vault.on('modify')` from re-triggering itself

```
SealFileSync (vault events → table re-index → bus events)
    ↓
Omnibus bus (change::files, change::links, etc.)
    ↓
Materializer (subscribes to bus events)
    ↓
vault.process() (atomic write)
    ↓
Write lock (suppresses re-trigger for 500ms)
```

#### Startup Behavior

On plugin load (`app.workspace.onLayoutReady`), after `SealFileSync.init()` completes:

1. Scan all `.md` files in the vault for `<!-- sqlseal: ... -->` markers
2. Parse all blocks
3. Execute and serialize all queries
4. Write any stale or missing materializations
5. Subscribe to bus events for ongoing liveness

This is a one-time bulk pass. Subsequent updates are incremental (triggered by bus events).

### Editing the Query

Three tiers of edit UX, from simplest to most polished:

#### Tier 1: Source View (No Plugin Work)

Users can always switch to source view and edit the HTML comment directly. The query is plain text.

#### Tier 2: Hover Edit Button

In live preview, the plugin registers a [`registerMarkdownPostProcessor`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerMarkdownPostProcessor) that detects materialized regions in the rendered document. Since HTML comments are stripped from the DOM, the post-processor identifies materialized tables by looking for the preceding comment in the raw section info (`context.getSectionInfo()`) and injects a small edit button widget.

Clicking the button opens an Obsidian [`Modal`](https://docs.obsidian.md/Reference/TypeScript+API/Modal) with:

- A `<textarea>` containing the SQL query (syntax-highlighted via [`@codemirror/language`](https://codemirror.net/docs/ref/#language), already a dependency)
- A "Run" button to preview results in a table below
- A "Save" button that writes the updated query back into the comment via `vault.process()`
- A "Cancel" button

The modal can also show bind variable values (read from the file's frontmatter) for debugging.

Prior art: [Dataview Serializer](https://github.com/dsebastien/obsidian-dataview-serializer)'s inline refresh button, [Meta Bind](https://github.com/mProjectsCode/obsidian-meta-bind-plugin)'s input field widgets.

#### Tier 3: Click-to-Reveal (Future)

Same pattern Obsidian uses for `**bold**`, `[[links]]`, and math blocks in live preview. Click into the materialized region and the raw comment + markdown source appears. Click away and it collapses back to rendered output. This requires a [CodeMirror 6](https://codemirror.net/docs/guide/) `ViewPlugin` with [`Decoration.replace`](https://codemirror.net/docs/ref/#view.Decoration%5Ereplace).

This tier is complex because it requires mapping between the CodeMirror document model and the rendered DOM. Deferred to a later release.

---

## Concrete Vault Examples

### Children Section (Index Notes)

Before (TEMPLATE):

````markdown
## Children

```sqlseal
TEMPLATE
{% include "_templates/children-table.njk" %}

SELECT
  a(path, COALESCE(title, name)) as note,
  COALESCE(description, '') as description,
  COALESCE(status_as_of, '') as status_as_of
FROM files
WHERE parent = @parent AND path != @path AND name != @basename
ORDER BY COALESCE("order", 999), name
```
````

After (MATERIALIZE):

```markdown
## Children

<!-- sqlseal: SELECT a(path, COALESCE(title, name)) as note, COALESCE(description, '') as description, COALESCE(status_as_of, '') as status_as_of FROM files WHERE parent = @parent AND path != @path AND name != @basename ORDER BY COALESCE("order", 999), name -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
| note | description | status_as_of |
|:-----|:------------|:-------------|
| [[Projects/Body AI Corp/Strategy Canonical\|Strategy Canonical]] | Current baseline + evolution | 2026-02-20 |
| [[Projects/Body AI Corp/Action Tracker\|Action Tracker]] | Active open items | |
| [[Projects/Body AI Corp/Brand Name Suggestions\|Brand Name Suggestions]] | Name options for the company | |
<!-- /sqlseal -->
```

### Canonical Sources Section

Before (TEMPLATE):

````markdown
## Canonical Sources

```sqlseal
TEMPLATE
{% include "_templates/canonical-sources.njk" %}

SELECT
  a(path, COALESCE(title, name)) as note,
  COALESCE(canonical_label, '') as canonical_label,
  COALESCE(description, '') as description
FROM files
WHERE note_type = 'canonical' AND @path LIKE parent || '/%'
ORDER BY title
```
````

After (MATERIALIZE, list format):

```markdown
## Canonical Sources

<!-- sqlseal-list: SELECT a(path, COALESCE(title, name)) as link, canonical_label as label, description FROM files WHERE note_type = 'canonical' AND @path LIKE parent || '/%' ORDER BY title -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
- **[[Projects/Body AI Corp/Action Tracker|Actions]]** — Active open items with provenance links
- **[[Projects/Body AI Corp/Strategy Canonical|Strategy]]** — Current baseline + evolution chronology
<!-- /sqlseal -->
```

### Related Section (Backlinks)

Before (TEMPLATE):

````markdown
## Related

```sqlseal
TEMPLATE
{% include "_templates/related-links.njk" %}

SELECT DISTINCT
  a(f.path, COALESCE(f.title, f.name)) as link,
  f.description
FROM links l
JOIN files f ON f.path = l.path
WHERE l.target = @path
```
````

After (MATERIALIZE, list format):

```markdown
## Related

<!-- sqlseal-list: SELECT DISTINCT a(f.path, COALESCE(f.title, f.name)) as link, f.description FROM links l JOIN files f ON f.path = l.path WHERE l.target = @path -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
- **[[Meeting Notes/AI Weekly Prep - 2026-02-26/AI Weekly Prep - 2026-02-26|AI Weekly Prep]]** — Weekly AI team sync
- **[[Projects/Maximus/Maximus|Maximus]]** — Project root
<!-- /sqlseal -->
```

### Siblings Section

Before (TEMPLATE):

````markdown
## Siblings

```sqlseal
TEMPLATE
{% include "_templates/siblings.njk" %}

SELECT
  a(path, COALESCE(title, name)) as note,
  COALESCE(description, '') as description
FROM files
WHERE parent = @parent AND path != @path AND name != @basename
ORDER BY COALESCE("order", 999), name
```
````

After (MATERIALIZE):

```markdown
## Siblings

<!-- sqlseal: SELECT a(path, COALESCE(title, name)) as note, COALESCE(description, '') as description FROM files WHERE parent = @parent AND path != @path AND name != @basename ORDER BY COALESCE("order", 999), name -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
| note | description |
|:-----|:------------|
| [[Projects/Body AI Corp/Infrastructure/Alerting\|Alerting]] | Monitoring and alert configuration |
| [[Projects/Body AI Corp/Infrastructure/Technology Stack\|Technology Stack]] | Core infrastructure components |
<!-- /sqlseal -->
```

---

## CLI Companion

A standalone script that materializes queries outside of Obsidian. Written in TypeScript, runs via `bun`.

### Architecture

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

### Shared Code Extraction

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

### Vault Indexing

The CLI builds an in-memory SQLite database (via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)) with the same four tables SQLSeal populates inside Obsidian:

| Table | Columns | Source | Mirrors |
|:------|:--------|:-------|:--------|
| `files` | `id, path, name, parent, depth, created_at, modified_at, file_size` + all frontmatter fields | Walk `.md` files, parse frontmatter with [`gray-matter`](https://github.com/jonschlinkert/gray-matter) | `FilesFileSyncTable` |
| `tags` | `tag, fileId, path` | Extract `tags` from frontmatter + inline `#tags` via regex | `TagsFileSyncTable` |
| `links` | `path, target, display_text, target_exists` | Parse `[[...]]` patterns from file body (excluding code blocks and comments) | `LinksFileSyncTable` |
| `tasks` | `path, task, completed, position, heading, heading_level` | Parse `- [ ]` / `- [x]` patterns | `TasksFileSyncTable` |

The `files` table mirrors `FilesFileSyncTable` from `src/modules/sync/sync/tables/filesTable.ts`. Key difference: the plugin uses `app.metadataCache.getFileCache(file).frontmatter` to extract frontmatter; the CLI uses `gray-matter` to parse YAML from raw file content.

### Link Resolution

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

### Query Execution

1. Find all `<!-- sqlseal: ... -->` markers in `.md` files (using shared `parseMaterializeBlocks()`)
2. Parse the SQL query from each marker
3. Resolve bind variables from the file's frontmatter (parsed via `gray-matter`)
4. Register `a()` as a custom SQL function that returns `SQLSEALCUSTOM({"type":"a","values":["<path>","<name>"]})` (matching the plugin's internal representation). The serializer then calls `renderAsString()` on this, producing `[[path|title]]`.
5. Execute the query against the local SQLite DB
6. Serialize results via shared `formatMarkdownTable()` / `formatList()`
7. Compare with existing content between markers
8. Write if different, update timestamp

### Drift Mitigation

The CLI and plugin must produce **byte-identical output** for the same query and data. Both use:

- Same SQL function signatures (`a()` with 2 args, registered via `registerCustomFunction`)
- Same `renderAsString` logic from shared package (`[[path|title]]` for internal links, `[name](url)` for external)
- Same `formatMarkdownTable()` / `formatList()` from shared package
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

# Dry run: show what would change without writing
sqlseal-cli materialize /path/to/vault --dry-run

# Verbose: show each file and query being processed
sqlseal-cli materialize /path/to/vault --verbose
```

### CI / Pre-Commit Integration

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

---

## HTML Comment `--` Restriction

HTML comments cannot contain `--` (double hyphen). The HTML spec states that `--` inside `<!-- -->` is invalid and browsers/parsers handle it inconsistently. SQL queries may use `--` for line comments or `--` may appear in string literals.

### Mitigation: Encoding

Replace `--` with the HTML entity `&#45;&#45;` inside the comment. The parser decodes before execution:

```typescript
function decodeQuery(raw: string): string {
    return raw.replace(/&#45;&#45;/g, '--');
}

function encodeQuery(sql: string): string {
    return sql.replace(/--/g, '&#45;&#45;');
}
```

This is transparent: the user writes normal SQL in the edit modal, and the plugin encodes when saving to the comment.

### Mitigation: External File Import

For complex queries, use `<!-- sqlseal-file: _queries/complex.sql -->`. The `.sql` file has no encoding restrictions. The plugin and CLI read the file content directly.

### Recommendation

Default to inline queries with encoding. Reserve external file import for queries that are reused across multiple notes or are too long for comfortable inline editing.

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
| Nunjucks templates | No | No | Yes | No (markdown table / list) |
| CLI companion | No | No | No | Yes |
| Timestamp | No | No | No | Yes |
| Edit UX | Edit comment in source view | Edit codeblock | Edit codeblock | Hover button / modal |
| Anti-loop protection | Content comparison + 5s debounce | N/A (manual) | N/A (ephemeral) | Content comparison + write lock + debounce |

---

## Migration Path

### From TEMPLATE to MATERIALIZE

For each existing `sqlseal` codeblock with TEMPLATE:

1. Extract the SQL query (strip the `TEMPLATE` directive and Nunjucks `{% include %}` line)
2. Encode `--` occurrences if present
3. Wrap the query in `<!-- sqlseal: <SQL> -->`
4. Execute the query and serialize results as a markdown table
5. Construct the full marker block (query comment + timestamp + table + end sentinel)
6. Replace the entire ```` ```sqlseal ... ``` ```` codeblock with the marker block
7. Save the file

A migration command (`SQLSeal: Migrate TEMPLATE to MATERIALIZE`) automates this. Two modes:

- **Current file:** Migrate all TEMPLATE codeblocks in the active file
- **Vault-wide:** Migrate all TEMPLATE codeblocks across all `.md` files

The command shows a confirmation dialog with the number of codeblocks to migrate and a diff preview.

### Mapping Nunjucks Templates to Output Formats

| Nunjucks Template | MATERIALIZE Format |
|:------------------|:-------------------|
| `children-table.njk` | Table (default) |
| `canonical-sources.njk` | List (`sqlseal-list`) |
| `related-links.njk` | List (`sqlseal-list`) |
| `siblings.njk` | Table (default) |
| `kv-table.njk` | Table (default) |

The migration command uses this mapping to select the correct `sqlseal` / `sqlseal-list` directive.

### Backward Compatibility

TEMPLATE mode continues to work unchanged. MATERIALIZE is additive. Users can mix both modes in the same vault. The migration is opt-in per query.

---

## Implementation Scope

### Phase 1: Core Materialization (MVP)

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Marker parser | 1 day | `src/modules/editor/materialize/markerParser.ts` |
| Serializer (renderAsString + formatMarkdownTable) | 1 day | `src/modules/editor/materialize/serializer.ts`. Reuses `ParseResults.renderAsString()`, `LinkParser.renderAsString()` |
| Materializer (query execution + write-back) | 2 days | `src/modules/editor/materialize/materializer.ts`. Reuses `transformQuery()`, `db.select()`, `registerObservers()` |
| Anti-loop protection (write lock + debounce) | 1 day | `src/modules/editor/materialize/writeLock.ts` |
| Plugin integration (register on load, subscribe to bus) | 1 day | Extends `src/modules/sync/module.ts` or new `src/modules/materialize/module.ts` |
| Tests | 2 days | Marker parser, serializer parity with `renderAsString`, anti-loop, edge cases |
| **Phase 1 Total** | **8 days** | |

### Phase 2: Edit UX + Migration

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Hover edit button (Tier 2) | 2 days | `src/modules/editor/materialize/editWidget.ts`. `registerMarkdownPostProcessor` + `Modal` |
| Migration command | 1 day | `src/modules/editor/materialize/migrateCommand.ts` |
| List output format (`sqlseal-list`) | 0.5 day | Extension to serializer |
| **Phase 2 Total** | **3.5 days** | |

### Phase 3: CLI Companion

| Component | Effort | Key Files |
|:----------|:-------|:----------|
| Shared package extraction | 1 day | `packages/shared/` (marker parser, formatters, link serializer) |
| Vault indexer | 1.5 days | `packages/cli/src/vault-indexer.ts` |
| CLI materializer | 1.5 days | `packages/cli/src/materializer.ts` |
| Link resolver | 0.5 day | `packages/cli/src/link-resolver.ts` |
| CLI commands (`materialize`, `check`, `stale`) | 1 day | `packages/cli/src/index.ts` |
| Parity tests (CLI vs plugin output) | 1 day | Compare output for sample vault |
| **Phase 3 Total** | **6.5 days** | |

### Grand Total: ~18 days

---

## Resolved Design Decisions

1. **Post-processor for reading view?** Yes, but only for the edit button (Tier 2). The markdown table itself renders natively. The post-processor injects the edit button widget and a subtle visual indicator (thin top border or small icon) to distinguish materialized sections from static markdown.

2. **Timestamp in frontmatter?** No. The per-block timestamp in `<!-- sqlseal-updated: ... -->` is sufficient. A file-level frontmatter field would cause unnecessary noise and trigger metadataCache re-indexing on every materialization, worsening the loop problem.

3. **`--` encoding vs external files?** Both. Encoding is the default (transparent to users via the edit modal). External file import is the escape hatch for complex queries or queries shared across files.

4. **Non-table output?** Yes, via `sqlseal-list` directive. List format is needed for Canonical Sources and Related sections. Plain format deferred until a use case emerges.

## Open Questions

1. **Should the materializer run on all vault files or only open files?** Running on all files ensures consistency but may cause performance issues on large vaults. Running only on open files is cheaper but leaves background files stale. Recommendation: all files on startup, open files only during live editing. CLI handles full-vault materialization.

2. **Should auto-rename update the query comment?** When Obsidian auto-renames a wikilink in the materialized output, the output changes but the query hasn't re-executed. On the next materialization, the query will produce the old path (which now 404s). Should the materializer detect renamed paths in the output and update the query's `WHERE` clauses? Probably not — the query references table/column names, not specific paths. The next materialization will naturally produce the updated paths because the `files` table reflects the rename.

3. **Interaction with `vault.process()` and sync plugins.** If the user has Obsidian Sync or a git-based sync running, materialization writes could cause merge conflicts. Mitigation: the `<!-- sqlseal-updated: ... -->` timestamp changes on every write, making conflicts easy to resolve (accept either side, then re-materialize). Document this as a known limitation.
