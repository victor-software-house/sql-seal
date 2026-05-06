# Markdown Renderer
Status: native Obsidian-rendered markdown.

The `MARKDOWN` renderer generates markdown with Nunjucks, then passes it through
Obsidian's own markdown renderer. Links, tables, headings, callouts, and embeds
behave like normal Obsidian-rendered markdown.

The template context matches `TEMPLATE`: `data`, `columns`, and `properties`.
Directives such as `missing='—'` and `blank='—'` are supported before the
template body.

```sqlseal
MARKDOWN
missing='—'
## {{ properties.title }}

{% for row in data %}
- **{{ row.note }}:** {{ row.status }}
{% endfor %}

SELECT note, status
FROM tasks
WHERE path = @path
```

If no template body is provided, SQLSeal generates a markdown table and renders
that table through Obsidian:

```sqlseal
MARKDOWN
SELECT * FROM files LIMIT 10
```

Generated markdown cannot include nested `sqlseal` fenced codeblocks. Use
`sql`, `md`, or escaped fences when documenting examples inside `MARKDOWN`
output.
