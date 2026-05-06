# Migration Path

How to migrate existing TEMPLATE codeblocks to MATERIALIZE comment blocks.

---

## From TEMPLATE to MATERIALIZE

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

---

## Mapping Nunjucks Templates to Output Formats

| Nunjucks Template | MATERIALIZE Format |
|:------------------|:-------------------|
| `children-table.njk` | Table (default) |
| `canonical-sources.njk` | List (`sqlseal-list`) |
| `related-links.njk` | List (`sqlseal-list`) |
| `siblings.njk` | Table (default) |
| `kv-table.njk` | Table (default) |

The migration command uses this mapping to select the correct `sqlseal` / `sqlseal-list` directive.

---

## Backward Compatibility

TEMPLATE mode continues to work unchanged. MATERIALIZE is additive. Users can mix both modes in the same vault. The migration is opt-in per query.
