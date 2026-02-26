# Implementation Details

Marker parser, serialization pipeline, and liveness mechanism for MATERIALIZE mode.

---

## Marker Parser

New module: `src/modules/editor/materialize/markerParser.ts`

### Regex Patterns

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

### Parsed Block Structure

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

### Parser Function

```typescript
function parseMaterializeBlocks(fileContent: string): MaterializeBlock[] {
    // 1. Find all <!-- sqlseal: ... --> or <!-- sqlseal-file: ... --> occurrences
    // 2. For each, find the matching <!-- /sqlseal --> sentinel
    // 3. Extract the query, timestamp, and current content
    // 4. Return array of blocks sorted by startOffset
    // 5. Validate: no overlapping blocks, no unclosed blocks
}
```

### Edge Cases

| Case | Behavior |
|:-----|:---------|
| No `<!-- /sqlseal -->` sentinel found | Skip block, log warning |
| Multiple blocks in one file | Process all independently, write back in one `vault.process()` call |
| Empty content (first materialization) | Insert table + timestamp between query marker and end sentinel |
| `--` inside query comment | Decode `&#45;&#45;` to `--` before execution (see [Prior Art](./prior-art.md)) |
| Nested HTML comments | Not supported by HTML spec. Not a concern. |
| Query comment inside a code block | Regex matches raw text, so this would be a false positive. Mitigation: check that the match offset is not within a fenced code block region. |

### Code Block Exclusion

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

---

## Serialization Pipeline

New module: `src/modules/editor/materialize/serializer.ts`

Reuses the existing code path from `CodeblockProcessor.render()` but diverges at the output stage.

### Existing Code Path (TEMPLATE)

```
parser.ts (ohm-js grammar) → parseWithDefaults()
    → CodeblockProcessor.render()
        → transformQuery() → db.select() → { data, columns }
        → RendererRegistry.prepareRender('template')
            → TemplateRenderer.render()
                → ParseResults.parse() → nunjucks.render() → el.innerHTML = ...
```

### New Code Path (MATERIALIZE)

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

### Markdown Table Formatting

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

### Output Format Options

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

---

## Liveness and Write-Back Loop

### The Infinite Loop Problem

This is the hardest technical challenge. The write-back loop:

1. Data changes in vault (file created/modified/deleted)
2. `SealFileSync` (`src/modules/sync/fileSyncController/FileSync.ts`) re-indexes the affected file via `onFileModify()` on all table plugins (`FilesFileSyncTable`, `TagsFileSyncTable`, `LinksFileSyncTable`, `TasksFileSyncTable`)
3. `SealFileSync.triggerChange()` calls `sync.triggerGlobalTableChange(name)` for each table
4. `bus.trigger('change::files')` fires
5. Materializer receives the event via `registerObservers` callback
6. Materializer re-executes query, serializes, compares, writes if different
7. Writing triggers `vault.on('modify')` — **back to step 2**

If the output hasn't changed, step 6 skips the write and the loop stops. But if the output *has* changed (e.g., a new child file was added), the write in step 6 triggers re-indexing in step 2. The re-indexed file now has new wikilinks (from the materialized table), which changes the `links` table, which fires `change::links`, which may trigger other materializers.

### Anti-Loop Strategy

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

### Integration with SealFileSync

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

### Startup Behavior

On plugin load (`app.workspace.onLayoutReady`), after `SealFileSync.init()` completes:

1. Scan all `.md` files in the vault for `<!-- sqlseal: ... -->` markers
2. Parse all blocks
3. Execute and serialize all queries
4. Write any stale or missing materializations
5. Subscribe to bus events for ongoing liveness

This is a one-time bulk pass. Subsequent updates are incremental (triggered by bus events).
