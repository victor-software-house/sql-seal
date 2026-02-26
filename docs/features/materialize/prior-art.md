# Prior Art and Constraints

Comparison with existing Obsidian plugins that serialize query output, and the HTML comment `--` restriction.

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
