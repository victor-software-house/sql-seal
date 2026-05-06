export const dailyLedgerFile = {
	path: "Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Daily/2026-05-06.md",
	basename: "2026-05-06",
	parentPath: "Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Daily",
	frontmatter: {
		title: "2026-05-06",
		note_type: "event",
		scope: "indeed",
		date: "2026-05-06",
	},
};

export const plainSqlQuery = "SELECT @title AS title, @date AS date, @parent AS parent";

export const plainSqlResult = {
	columns: ["title", "date", "parent"],
	data: [
		{
			title: dailyLedgerFile.frontmatter.title,
			date: dailyLedgerFile.frontmatter.date,
			parent: dailyLedgerFile.parentPath,
		},
	],
};

export const sdlcTemplateBlock = `
TABLE jira_events = file(Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Data/jira_events.csv)
TABLE gitlab_notes = file(Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Data/gitlab_notes.csv)

TEMPLATE
missing='—'
{% include "_templates/sdlc-deltas.njk" %}

SELECT source_created_at_brt, 'GitLab note' as source, item, class, note, a(url, 'open') as link
FROM gitlab_notes
WHERE source_created_at_brt >= @date || 'T00:00:00-03:00'
UNION ALL
SELECT source_created_at_brt, 'Jira event' as source, item, event_type as class, note, a(url, 'open') as link
FROM jira_events
WHERE source_created_at_brt >= @date || 'T00:00:00-03:00'
ORDER BY source_created_at_brt DESC
`;

export const transformedSdlcTemplateQuery = `SELECT source_created_at_brt, 'GitLab note' as source, item, class, note, a(url, 'open') as link
FROM file_gitlab_notes
WHERE source_created_at_brt >= @date || 'T00:00:00-03:00'
UNION ALL
SELECT source_created_at_brt, 'Jira event' as source, item, event_type as class, note, a(url, 'open') as link
FROM file_jira_events
WHERE source_created_at_brt >= @date || 'T00:00:00-03:00'
ORDER BY source_created_at_brt DESC`;

export const sdlcTemplateResult = {
	columns: ["source_created_at_brt", "source", "item", "class", "note", "link"],
	data: [
		{
			source_created_at_brt: "2026-05-06T10:40:00-03:00",
			source: "Jira event",
			item: "EVO-6703",
			class: "status",
			note: "Moved to In Progress after confirming assignment behavior.",
			link: "[open](https://issues.example.invalid/EVO-6703)",
		},
		{
			source_created_at_brt: "2026-05-06T09:55:00-03:00",
			source: "GitLab note",
			item: "MR evo/evo-conversions !241",
			class: "actionable",
			note: "Draft merge request opened for seeded random assignment.",
			link: "[open](https://gitlab.example.invalid/evo/evo-conversions/-/merge_requests/241)",
		},
	],
};
