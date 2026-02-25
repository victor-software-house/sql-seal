# Template Renderer
Introduced in version 0.28.0.

Template renderer allows you to render your data using custom Nunjucks templates. It allows for greater control over how your resulting data is structured, allowing you to generate any markdown or HTML you wish.
Data from the query is exposed as `data` variable.

Learn more about Nunjucks syntax [in their official documentation](https://mozilla.github.io/nunjucks/).

## Variables
The following variables are exposed
| Variable   | Description                                        |
| ---------- | -------------------------------------------------- |
| data       | Array of the data returned by the SELECT statement |
| columns    | Array of column names                              |
| properties | Object containing all properties of the file       |


## Example
```sqlseal
TEMPLATE
Current Path: {{ properties.path }}
{% for row in data %}
    <div>{{ row.path }}</div>
{% endfor %}

SELECT * FROM files LIMIT 10
```

## Custom Filters

SQLSeal registers two custom Nunjucks filters:

### `groupby`
Groups an array of objects by a key. Returns an array of `{ grouper, list }` objects.

```sqlseal
TEMPLATE
{% for group in data | groupby("parent") %}
<h3>{{ group.grouper }}</h3>
<ul>
{% for row in group.list %}
  <li>{{ row.name }}</li>
{% endfor %}
</ul>
{% endfor %}

SELECT name, parent FROM files
```

### `unique`
Deduplicates an array. Pass an optional key to deduplicate by a specific field.

```sqlseal
TEMPLATE
{% for tag in data | unique("tag") %}
  <span>{{ tag.tag }}</span>
{% endfor %}

SELECT tag FROM tags
```

## `VaultLoader` and `{% include %}`

You can load `.njk` template files from your vault using `{% include %}`. The `VaultLoader` watches for file changes and keeps templates in sync.

```sqlseal
TEMPLATE
{% include "_templates/file-list.njk" %}

SELECT * FROM files LIMIT 10
```

