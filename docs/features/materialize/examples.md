# Concrete Vault Examples

Before/after comparisons showing how each dynamic section type migrates from TEMPLATE to MATERIALIZE.

---

## Children Section (Index Notes)

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

---

## Canonical Sources Section

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

---

## Related Section (Backlinks)

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

---

## Siblings Section

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
