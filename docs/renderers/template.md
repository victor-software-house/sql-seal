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

## Nunjucks Support and `VaultLoader`

SQLSeal supports Nunjucks features including custom filters like `groupby` and `unique`.

You can also use the `VaultLoader` to load template files directly from your vault using `{% include %}`.

### Example with Include
```sqlseal
TEMPLATE
{% include "_templates/file-list.njk" %}

SELECT * FROM files LIMIT 10
```

