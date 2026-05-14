# Nested Frontmatter Access

Status: proposed.

This PRD covers giving SQLSeal authors a natural dotted-path expression to read
nested frontmatter objects in the global `files` index, so a query can say
`post.status` instead of `json_extract(post, '$.status')` while preserving the
existing JSON-serialized storage format.

## Problem

`files` is a generic table built from each note's frontmatter plus a fixed set
of file metadata columns. The current sync pipeline indexes only the top-level
keys of `frontmatter` as columns. Each top-level key becomes its own SQLite
column, and any value of type `object` or `Array` is JSON-stringified into a
single `TEXT` cell:

`src/modules/database/worker/database.ts:32-50` — `formatData()` converts
`object` and `Array` values via `JSON.stringify(data[key])` before binding.
`src/modules/sync/sync/tables/filesTable.ts:11-18` — `extractFrontmatterFromFile`
sanitises top-level keys only; nested keys are never seen by `sanitise()` or by
`updateColumnsIfNeeded`.

The author-facing consequence: a note with frontmatter

```yaml
post:
  status: drafted
  url: null
  sent_at: null
  channel: "#evo-eng"
  thread_ts: null
```

cannot be queried as

```sql
SELECT post.status FROM files WHERE post.status != 'sent'
```

The author has to know that `post` is a `TEXT` column carrying a JSON blob and
write

```sql
SELECT json_extract(post, '$.status') AS status
FROM files
WHERE json_extract(post, '$.status') != 'sent'
```

This breaks natural SQL intuition, increases verbosity, complicates `ORDER BY`
and `WHERE` over the same field (the projection alias is not visible in
`WHERE`), and forces every author of object-typed frontmatter to learn the SQLite
JSON dialect before their first query works.

The objection is structural, not cosmetic: most real frontmatter schemas in the
target vault use nested objects (`post:`, `meeting:`, `links:`, `progress:`),
and Obsidian's metadata cache returns them as nested JavaScript objects. Saying
"flatten them to dotted column names" is wrong because some keys are themselves
dynamic (e.g. the field names inside `participants:`), and dotted-name flattening
would explode `files` column count and re-index frequency.

## Decision

Ship native dotted-path expression support in the SQLSeal query layer that
rewrites `<column>.<key1>[.<key2>...]` into `json_extract(<column>, '$.key1[.key2...]')`
before forwarding the SQL to SQLite.

The rewrite happens **at the SQLSeal query layer**, not at the storage layer.
Frontmatter still lands in SQLite as TEXT-typed JSON; the storage format is
unchanged. The rewrite is purely a sugar pass over the SQL the author wrote,
producing a query SQLite can already execute.

Backward compatibility is preserved: existing queries that already use
`json_extract(post, '$.status')` keep working unchanged.

## Rationale

Three reasons to do this at the rewrite layer rather than at storage:

1. **Storage stability.** Today's `post` TEXT column already works for every
   downstream consumer (REST API JSON, table renderer, template renderer,
   `ParseResults`). Materialising nested keys as additional columns means
   either (a) explosive column growth on dynamic-key objects, or (b) special-case
   logic to decide which nested keys deserve a column. Both add migration risk
   and add a new failure mode (schema drift between vaults). Leaving storage
   as-is means zero migration.

2. **Author intuition.** `post.status` is the natural SQL phrasing. The
   rewrite makes the syntax match the mental model of the frontmatter shape
   without forcing the author to learn `json_extract` or the `$.` JSON-path
   dialect first.

3. **Composability.** Once `post.status` resolves to `json_extract(post,
   '$.status')`, it composes naturally with `WHERE`, `ORDER BY`, `GROUP BY`,
   `CASE`, aliases (`AS`), and Nunjucks template interpolation. No separate
   resolution path is needed per clause.

The cost is modest: SQLSeal already parses SQL via `sql-parser-cst` for other
rewrites (table alias substitution, bind variables). One additional CST visitor
pass with deterministic semantics is straightforward to land and to test.

## Syntax

The author writes naturally; SQLSeal rewrites.

```sql
-- Unsent slack drafts (target syntax)
SELECT
  a(path, COALESCE(title, name)) AS draft,
  post.status                    AS status,
  post.channel                   AS channel,
  post.thread_ts                 AS thread_ts,
  status_as_of                   AS as_of
FROM files
WHERE note_type = 'slack-draft'
  AND (post.status IS NULL OR post.status != 'sent')
ORDER BY status_as_of DESC
```

Becomes (internally, before SQLite execution):

```sql
SELECT
  a(path, COALESCE(title, name)) AS draft,
  json_extract(post, '$.status')    AS status,
  json_extract(post, '$.channel')   AS channel,
  json_extract(post, '$.thread_ts') AS thread_ts,
  status_as_of                       AS as_of
FROM files
WHERE note_type = 'slack-draft'
  AND (json_extract(post, '$.status') IS NULL OR json_extract(post, '$.status') != 'sent')
ORDER BY status_as_of DESC
```

### Disambiguation: column vs dotted path

The rewrite rule fires when the left operand resolves to an existing TEXT column
on the active schema AND the right operand is a bare identifier (not a function
call or qualified subquery). Specifically:

- `post.status` where `post` is a column on `files` → `json_extract(post, '$.status')`.
- `files.path` (table.column) → untouched (this is a standard SQL qualified column reference).
- `t.col` where `t` is an alias for a table in the FROM clause → untouched.
- `post.status.extra` (chained) → `json_extract(post, '$.status.extra')`.
- `post."status"` (quoted identifier) → not supported; reserved for explicit column quoting.

The disambiguation is schema-aware: the visitor knows which identifiers in scope
are tables/aliases vs which are columns of TEXT type, and only rewrites when the
left-hand identifier is a column.

### Arrays and array indexing

Phase 1 supports object-keyed traversal only. Array indexing (`tags[0]`,
`tags[*]`) is a Phase 2 concern documented under *Open Questions*.

### NULL semantics

Existing SQLite `json_extract` NULL semantics are preserved exactly:

- Missing key → SQL `NULL`.
- Key present, value `null` → SQL `NULL`.
- Key present, value is an object/array → SQL `NULL` (extracts the JSON text
  representation when wrapped via `json_quote`; this PRD does not change that).

This matches the `json_extract` behavior the few existing fork queries rely on,
so existing queries that already use `json_extract` continue to behave
identically.

## Design

The SQL-handling discipline for this feature is **enterprise-grade**: zero
regex anywhere, full CST awareness, scope tracking that mirrors SQL's own
name-resolution rules, and a fail-closed posture on anything the visitor
cannot resolve confidently. The contract below is the implementation target.

### Where the rewrite lives

Add a pre-execution rewrite pass to the SQLSeal SQL preparation pipeline,
between bind-variable substitution and the call to
`SqlSealDatabase.select(statement, frontmatter)` (`src/modules/database/database.ts:115-118`).
The same rewrite also wraps `SqlSealDatabase.explain` so `EXPLAIN` reflects the
statement SQLite actually executes.

### Parsing stack and guarantees

The rewrite is implemented as a pure function:

```ts
rewriteNestedFrontmatterAccess(
  sql: string,
  schema: SchemaSnapshot,
  options?: { dialect?: 'sqlite'; onUnresolved?: 'leave' | 'warn' },
): RewriteResult;

type RewriteResult = {
  sql: string;            // rewritten statement, byte-equal to input if nothing matched
  rewrites: RewriteSpan[];// CST-position spans of every node that was transformed
  warnings: Warning[];    // ambiguous cases the visitor declined to rewrite
};
```

**Hard parsing rules:**

1. **No regex.** Every decision is made against `sql-parser-cst` CST nodes
   (already a SQLSeal dependency for other rewrite work). String-based
   detection is not permitted because it cannot distinguish `post.status` in
   `SELECT` from `'post.status'` in a string literal or `post.status` inside a
   block comment.
2. **Full CST round-trip.** The rewrite produces the new SQL by serializing
   the modified CST, not by string-splicing. `sql-parser-cst` preserves
   whitespace, comments, and the dialect's identifier-quoting style; the
   rewritten output must keep those intact for everything that was not
   touched.
3. **Idempotent.** `rewrite(rewrite(s)) === rewrite(s)` for every input.
   Verified by a property test that fuzzes member-expression occurrences.
4. **Side-effect free.** The function does not query SQLite, does not touch
   the vault, does not mutate the schema snapshot.
5. **Parser-failure recovery.** If `sql-parser-cst` raises on the input, the
   rewrite returns `{ sql: <input>, rewrites: [], warnings: [parseError] }`
   and the caller forwards the original SQL to SQLite unchanged. A surfaced
   author error from SQLite is always better than an empty rejection from
   the rewrite layer.
6. **Dialect-aware.** The visitor is constructed with the SQLite dialect
   selected in `sql-parser-cst`. JSON-path quoting uses SQLite's
   `$."weird key"` form when a path component contains characters outside
   `[A-Za-z0-9_]`.

### Name resolution (SQL-grade scoping)

The visitor implements proper SQL name resolution. It is **not** a flat
`(alias, column)` lookup. The scope stack tracks:

- **Top-level query.** `FROM` source list + JOINs + USING + lateral-derived
  tables produce the outermost scope's symbol table.
- **CTE (`WITH`) bindings.** Each CTE name binds in the outer query and in
  any subsequent CTE in the same `WITH` list (recursive CTEs additionally
  bind their own name in their body via SQLite's `WITH RECURSIVE`). CTEs
  shadow same-named base tables for the duration of the enclosing
  statement.
- **Sub-SELECT in FROM** (`FROM (SELECT ...) t`). The sub-SELECT introduces
  its own inner scope; the alias `t` becomes a relation in the enclosing
  scope whose columns are the sub-SELECT's projection list.
- **Correlated subqueries** in WHERE / SELECT / JOIN. The outer scope is
  visible inside; column resolution searches inner-first, then walks
  outward.
- **Window function frames.** Identifiers inside `OVER (...)` resolve
  against the same scope as the containing SELECT.
- **Set operators** (`UNION`, `INTERSECT`, `EXCEPT`). Each branch has its
  own scope; the rewrite is applied independently per branch.
- **JOIN ON / USING.** The names visible on each side of the JOIN are
  available in `ON` / `USING` per the standard.
- **RETURNING.** Names from the target table of `INSERT` / `UPDATE` /
  `DELETE` are visible in the `RETURNING` clause.

**Disambiguation rule** for `LHS.RHS` member expressions:

```
resolve(LHS, RHS, scope):
  if LHS matches a table alias in scope         → leave node alone (standard SQL qualified column)
  if LHS matches a CTE / sub-SELECT alias       → leave node alone
  if LHS matches a column on exactly one
     table in scope, and that column is TEXT    → rewrite to json_extract(LHS, '$.RHS')
  if LHS matches a column on multiple tables    → leave node alone (SQL ambiguity; let SQLite surface it)
  if LHS matches no symbol in scope             → leave node alone (let SQLite raise undefined-column)
  if LHS is itself a complex expression
     (function call, parenthesized expr, etc.)  → leave node alone (Phase 2 territory)
```

The rule is intentionally conservative: when in doubt, do not rewrite, and
let SQLite produce its native diagnostic. A wrong rewrite is invisible (the
query silently returns NULLs); a missing rewrite is loud (SQLite raises
`no such column`). The conservative side is the right side.

### Where dotted-path access can appear

The visitor must recognise dotted-path candidates in every clause where a
column reference is grammatical. From the SQLite grammar (with sql-parser-cst
node names in parentheses where useful):

| Clause / context | Notes |
|:--|:--|
| `SELECT` projection list | Including `SELECT DISTINCT`, `SELECT ALL`, and aliased expressions (`AS`). |
| `WHERE` predicate | Including nested `AND`/`OR`/`NOT`. |
| `ORDER BY` items | Including expressions, position-numbers stay alone. |
| `GROUP BY` items | Same. |
| `HAVING` predicate | Same. |
| `CASE WHEN` arms (simple and searched) | Both `WHEN <expr> THEN ...` and `WHEN <pred> THEN ...`. |
| `JOIN ON` predicate | Including `LEFT/RIGHT/FULL/INNER/CROSS` join. |
| `JOIN USING (col, ...)` | Column names only; no dotted-path possible inside `USING`, but its presence affects scope. |
| Window function frames (`OVER (PARTITION BY ... ORDER BY ...)`) | Both partition and order keys. |
| Common table expressions, recursive and non-recursive | Body of each CTE, including `WITH RECURSIVE name(col, ...) AS ( <body> )`. |
| Sub-SELECTs in FROM, SELECT, WHERE, EXISTS, IN | Recursively, each sub-SELECT establishes its own scope and is visited. |
| Set-operator branches (`UNION`, `INTERSECT`, `EXCEPT`, `UNION ALL`) | Each branch is an independent visit. |
| `INSERT ... RETURNING`, `UPDATE ... RETURNING`, `DELETE ... RETURNING` | Per SQLite's RETURNING grammar. |
| Table-valued function arguments | E.g. `json_each(post)` — the argument expression itself is visited. |
| `VALUES` lists | No dotted-path in `VALUES`, but visited to recurse safely. |

A single visit-once traversal covers all of these by descending into every
expression child of every SQL statement node. Each occurrence is then
resolved against the scope active at that node.

### Schema snapshot

The visitor needs, for every table or relation in scope, the list of
columns and (optionally) their declared SQL types. The `files` table is
`TEXT` end-to-end (see `worker/database.ts:90-92`), but other tables (CSV
sources, future typed tables) may carry richer type info; the visitor must
only sugar columns whose type is `TEXT` (or column-affinity `BLOB`/`NONE`,
which SQLite treats compatibly for `json_extract`).

Two implementation choices for the snapshot:

- **Inline schema query.** Call `db.getColumns(tableName)` plus a
  `PRAGMA table_info(<table>)` per rewrite. One round-trip per query;
  cost is dominated by the worker comlink hop. Acceptable for v1.
- **Cached schema in `SqlSealDatabase`.** Hold a `Map<tableName,
  ColumnInfo[]>` invalidated on `addColumns` / `createTable` / `dropTable`
  events. Faster but adds state. Adopted in Phase 2 if profiling shows the
  inline query is hot.

The snapshot type is explicit and small:

```ts
type SchemaSnapshot = {
  tables: Map<string, ColumnInfo[]>;     // table name (lowercased) → columns
  resolveAlias(alias: string): string | null; // when a SELECT introduces aliases at runtime
};
type ColumnInfo = {
  name: string;
  affinity: 'TEXT' | 'NUMERIC' | 'INTEGER' | 'REAL' | 'BLOB' | 'NONE';
};
```

The rewrite resolves identifiers in a case-insensitive manner per SQLite's
default collation, which the implementation honors by lowercasing
identifiers at lookup time. Quoted identifiers (`"Mixed\"Case"`) preserve
case; the visitor compares them case-sensitively, again matching SQLite.

### JSON-path generation

For a chained access like `post.status.history`, the visitor produces:

```
json_extract(post, '$.status.history')
```

For a key with characters that would break unquoted JSON-path notation, the
visitor falls back to SQLite's quoted-key syntax:

| Author wrote | Rewrite output |
|:--|:--|
| `post.status` | `json_extract(post, '$.status')` |
| `meeting."weird key"` | `json_extract(meeting, '$."weird key"')` |
| `post.history.last` | `json_extract(post, '$.history.last')` |

The SQL string literal embedded in the rewrite is properly escaped via the
standard `''` single-quote-doubling rule (no shell-style backslashes,
matching SQLite syntax).

### Output stability

The rewritten SQL is generated by serializing the modified CST. Properties:

- For inputs with no member-expression candidates the output is
  byte-identical to the input.
- For inputs that did get rewritten, the only changes are inside the
  affected `<column>.<key>` ranges; surrounding whitespace, comments, and
  identifier quoting are preserved.
- `EXPLAIN` of the sugared form yields the same plan as the explicit
  `json_extract` form. This is asserted in the e2e test suite.

### Error envelope

If parsing fails entirely (`sql-parser-cst` cannot recover), the rewrite
returns the original input unchanged plus a `parseError` warning. The
surrounding pipeline forwards the original SQL to SQLite. SQLite's diagnostic
is surfaced to the author through the existing error path — i.e. the author
gets the same experience they had before this feature shipped if the SQL is
malformed.

If rewriting partially succeeds (some candidates resolved, others left
alone due to ambiguity), the `warnings[]` array carries one entry per
unresolved case with the CST position; the SQLSeal codeblock processor
renders these as inline hints. **No silent miss.** Authors learn when a
`post.status` reference was not sugared and why.

### Source files touched

| File | Change |
|:--|:--|
| `src/modules/database/database.ts` | Wire a `rewriteNestedFrontmatterAccess(statement, schema)` call into `select()` and `explain()`. |
| `src/modules/database/rewrite/nestedFrontmatterAccess.ts` (new) | Visitor implementation. Pure, side-effect free. |
| `src/modules/database/rewrite/schemaSnapshot.ts` (new) | Builds a `SchemaSnapshot` from the worker's `PRAGMA table_info` for every referenced table. |
| `src/modules/database/rewrite/__tests__/nestedFrontmatterAccess.test.ts` (new) | Unit tests, table-driven across the test matrix below. |
| `src/modules/database/rewrite/__tests__/nestedFrontmatterAccess.property.test.ts` (new) | Property tests for idempotency and pass-through. |
| `src/modules/api/restApi.ts` | Surface the rewritten SQL under a `debugQuery` field in REST responses so consumers can inspect both. Verify against `src/modules/api/__fixtures__/restApiFixtures.ts`. |
| `src/modules/sync/sync/tables/filesTable.ts` | No change. Storage path stays as-is. |
| `src/modules/database/worker/database.ts` | No change. Storage path stays as-is. |
| `docs/query-configuration.md` | New "Nested frontmatter access" subsection. |
| `docs/troubleshooting.md` | Note on the json_extract fallback for unsupported edge cases. |

### Test matrix

Every case below has a unit test. Each row pairs an author input with the
expected behavior; positions are CST-anchored. The test suite is
table-driven so a contributor can add a row and inherit the harness.

| Input pattern | Expected behavior |
|:--|:--|
| `SELECT name FROM files` | Pass-through. Output byte-equal to input. |
| `SELECT files.name FROM files` | Pass-through; `files.name` is a table-qualified column. |
| `SELECT post.status FROM files` | Rewritten in projection. |
| `WHERE post.status != 'sent'` | Rewritten in WHERE. |
| `ORDER BY post.sent_at DESC` | Rewritten in ORDER BY. |
| `GROUP BY post.channel` | Rewritten in GROUP BY. |
| `HAVING json_extract(post, '$.status') = 'sent'` | Pass-through; explicit `json_extract` left alone. |
| `SELECT post.status FROM files WHERE post.status IS NULL OR post.status != 'sent'` | All three occurrences rewritten. |
| `SELECT post.history.last FROM files` | Chained access rewritten to `'$.history.last'`. |
| `SELECT post."weird key" FROM files` | Quoted RHS rewritten to `'$."weird key"'`. |
| `SELECT post.status FROM files post` | Alias collision: `post` is the FROM alias. Member expression left alone. |
| `WITH p AS (SELECT post FROM files) SELECT p.post FROM p` | CTE alias `p` shadows; member access left alone. |
| `WITH p AS (SELECT post FROM files) SELECT json_extract(p.post, '$.status') FROM p` | Pass-through (explicit json_extract); demonstrates layered usage. |
| `SELECT (SELECT post.status FROM files WHERE id = outer.id) FROM files outer` | Correlated subquery: `post.status` rewritten inside, `outer.id` is alias-qualified and left alone. |
| `SELECT post.status FROM files UNION SELECT post.status FROM files WHERE post.channel = '#x'` | Each UNION branch visited independently; all four occurrences rewritten. |
| `SELECT row_number() OVER (PARTITION BY post.channel ORDER BY post.sent_at) FROM files` | Window function partition + order rewritten. |
| `SELECT CASE WHEN post.status = 'sent' THEN 1 ELSE 0 END FROM files` | CASE rewritten. |
| `SELECT * FROM files f JOIN files g ON f.path = g.path AND f.post.status = g.post.status` | Both sides of JOIN ON rewritten; `f.path` / `g.path` are alias-qualified and left alone. |
| `SELECT * FROM json_each(post)` | Pass-through; `post` is a function arg, not a member expression. |
| `INSERT INTO sink (col) VALUES (1) RETURNING post.status` (hypothetical) | Rewritten in RETURNING when the target relation has a TEXT `post` column. |
| Mixed-case identifier `Post.Status` against lowercased table | Rewritten case-insensitively, matching SQLite's default collation. |
| Malformed SQL: `SELEC post.status FROM files` | Parse fails; original input passed through unchanged + `parseError` warning. |
| Property: random valid SQL fed twice through the rewriter | Output of second pass equals output of first (idempotency). |
| Property: random valid SQL with no `<col>.<key>` patterns | Output byte-equal to input (pass-through). |

### Performance budget

- Per-query overhead must stay below 5 ms on a 200-row `files` table for a
  10-clause SELECT, measured on a clean session.
- The rewrite must not trigger additional Comlink round-trips to the worker
  beyond the existing `getColumns` and `PRAGMA table_info` calls.
- No SQL is sent to SQLite from the rewrite path itself; the schema
  snapshot is built once per `select()` invocation.

### Telemetry hooks (Phase 2)

When the SQLSeal observability hooks land (separate feature), the rewrite
emits one event per `select()` carrying `{ rewriteCount, warningCount,
parserMs }`. This is wired in Phase 2; Phase 1 keeps the rewrite silent.

## Non-Goals

- **No change to storage.** Object-valued frontmatter still lands as
  JSON-stringified `TEXT` columns. The decision in `formatData()` is intentional
  and preserved.
- **No materialization of nested keys as columns.** Materialising `post.status`
  as a `post_status` column would require `extractFrontmatterFromFile` to walk
  arbitrary depth and decide on naming conflicts; explicitly out of scope.
- **No syntax for array indexing.** `tags[0]` and `tags[*]` are Phase 2.
- **No new typed JSON path operators.** This PRD does not introduce `->`, `->>`,
  or `@>`; it only sugars `.` to `json_extract` with the most common path shape.
- **No author-facing tool to introspect the JSON shape.** Authors discover
  nested keys by reading the source note. A future `DESCRIBE files` or similar
  introspection is separate work.
- **No retroactive changes to existing fork tests** that use `json_extract`
  explicitly. They continue to pass; new tests cover the sugared form.

## Open Questions

1. **Quoted JSON path keys.** SQLite supports keys with special characters via
   `$."weird key"`. The dotted syntax in this PRD does not handle keys
   containing `.` or quotes. Decision: such keys fall back to `json_extract`
   with a quoted JSON path string. Document the boundary.
2. **Array indexing.** Phase 2 likely needs `tags[0]` → `json_extract(tags, '$[0]')`.
   What syntax for "all elements"? SQLite's `json_each` is the orthodox answer
   but is a table-valued function and changes the FROM clause; out of scope here.
3. **Conflict between table alias and column name.** If a user defines an alias
   `post` (`SELECT ... FROM files post WHERE post.path = ...`), the rewrite
   visitor must prefer the alias. Schema awareness handles this, but tests must
   cover the collision.
4. **Performance of repeated `json_extract` calls on the same column in the
   same query.** SQLite already de-duplicates identical scalar subqueries in
   the plan, so a `WHERE post.status != 'sent' ORDER BY post.status` should not
   double-parse the JSON. Verify on a representative dataset before claiming
   parity.
5. **Behaviour when column is TEXT but value is not JSON.** Frontmatter strings
   that look like text (not JSON) become TEXT cells through `formatData`. If an
   author writes `name.first` against a string column, `json_extract` returns
   NULL silently. Should this produce a query-time warning? Phase 2 affordance.
6. **REST API contract.** `restApi.ts` forwards the rewritten SQL or the
   original? Decision: forward the rewritten SQL but include the original in a
   `debugQuery` field so consumers can inspect both. Verify the fixture set
   under `src/modules/api/__fixtures__/restApiFixtures.ts` covers this.

## Acceptance Criteria

The change ships when all of the following hold:

1. **Parser unit tests.** `nestedFrontmatterAccess.test.ts` passes for at least
   the following input categories:
   - Bare column reference: untouched (`SELECT name FROM files`).
   - Table-alias-qualified reference: untouched (`SELECT files.name FROM files`).
   - Single-level dotted access in `SELECT`: rewritten.
   - Single-level dotted access in `WHERE`: rewritten.
   - Single-level dotted access in `ORDER BY`: rewritten.
   - Chained dotted access (`post.detail.status`): rewritten to `'$.detail.status'`.
   - Mixed query containing both sugared `post.status` and explicit
     `json_extract(post, '$.url')`: rewritten consistently; outputs are
     equivalent to a fully-sugared form.
   - Alias collision (`SELECT post.status FROM files post WHERE post.path = ...`):
     leaves alias-qualified accesses alone, rewrites column-typed accesses.
   - Idempotency: running the rewrite twice on the same input is a no-op after
     the first pass.
2. **End-to-end test with a real frontmatter object.** Create a test vault with
   a note carrying a `post:` nested object; assert that
   `SELECT post.status FROM files WHERE note_type = 'slack-draft'` returns the
   expected value via the worker pipeline.
3. **EXPLAIN parity.** `explain(sugaredSql)` produces the same plan as
   `explain(equivalentJsonExtractSql)`.
4. **REST API contract.** A REST call that runs the sugared form returns the
   same rows as the explicit form; the rewritten SQL is logged or surfaced
   under a documented field.
5. **Documentation.** `docs/query-configuration.md` gains a "Nested frontmatter
   access" subsection that introduces the syntax with the slack-drafts example
   from this PRD. `docs/troubleshooting.md` gains a note on when to fall back
   to explicit `json_extract` (quoted keys, special characters).
6. **Changeset.** A `.changeset/*.md` file is added classifying this as a
   `minor` bump (new feature, no breakage); the release rule on consecutive
   non-patch bumps from `AGENTS.md` is honored.
7. **Typecheck and Jest.** `pnpm run typecheck && pnpm test` is green.

## Compatibility

- **Backward compatible.** Existing queries using `json_extract(post, '$.status')`
  continue to work unchanged.
- **No schema migration.** The `files` table structure does not change.
- **No frontmatter format change.** Authors do not need to restructure existing
  notes.
- **Vaults using upstream SQLSeal** that do not have this rewrite still receive
  the same TEXT-stored frontmatter, so queries that explicitly use
  `json_extract` are portable between fork and upstream. Queries that use the
  sugared `post.status` form are fork-specific until upstream adopts the same
  pass.

## Phases

| Phase | Scope | Release |
|:--|:--|:--|
| 1 | The dotted-access rewrite for `SELECT`, `WHERE`, `ORDER BY`, `GROUP BY`, `HAVING`, `CASE`. Single-level + chained object keys. Alias-collision safety. Pass-through for queries without sugar. | `minor` (changeset included). |
| 2 | Array indexing (`tags[0]`, `tags[N]`). Optional `json_each`-backed expansion of `tags[*]`. Quoted-key handling. | `minor`. |
| 3 | Optional schema-introspection affordance (`DESCRIBE files` or a SQLSeal `EXPLAIN SHAPE` directive). Out of scope for this PRD; logged for future planning. | TBD. |

## References

- Existing query layer: `src/modules/database/database.ts`,
  `src/modules/database/worker/database.ts`.
- Frontmatter indexing: `src/modules/sync/sync/tables/filesTable.ts`,
  `src/utils/sanitiseColumn.ts`.
- Parser stack: `sql-parser-cst` (already a dependency).
- Motivating use case: the slack-draft companion notes under
  `~/workspace/obsidian-vault/Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Daily/`
  use a `post:` object for `status`, `url`, `sent_at`, `channel`, `thread_ts`.
  The SQLSeal surface in `SDLC Bookkeeping.md` § "Unsent Slack Drafts" demonstrates
  the current `json_extract` workaround that this PRD removes.
