import { executeSqlSealRequest } from "./restApi";
import {
	dailyLedgerFile,
	plainSqlQuery,
	plainSqlResult,
	sdlcTemplateBlock,
	sdlcTemplateResult,
	transformedSdlcTemplateQuery,
} from "./__fixtures__/restApiFixtures";

function createApp(frontmatter: Record<string, unknown> = dailyLedgerFile.frontmatter) {
	const tFile = {
		path: dailyLedgerFile.path,
		basename: dailyLedgerFile.basename,
		parent: { path: dailyLedgerFile.parentPath },
	};

	return {
		vault: {
			getFileByPath: jest.fn((path: string) => path === tFile.path ? tFile : null),
		},
		metadataCache: {
			getFileCache: jest.fn(() => ({ frontmatter })),
		},
	};
}

function createRendererRegistry() {
	return {
		flags: [],
		getViewDefinitions: jest.fn(() => [
			{ name: "GRID", argument: "anyObject?", singleLine: false },
			{ name: "MARKDOWN", argument: "restLine?", singleLine: true },
			{ name: "TEMPLATE", argument: "nunjucksTemplate?", singleLine: false },
		]),
		prepareRender: jest.fn((type: string, options: string) => (el: HTMLElement) => ({
			render: ({ columns, data }: { columns: string[]; data: Record<string, unknown>[] }) => {
				el.innerHTML = JSON.stringify({
					renderer: type,
					options,
					columns,
					rowCount: data.length,
				});
			},
			error: jest.fn(),
			cleanup: jest.fn(),
		})),
	};
}

function createSync(tableMap: Record<string, string> = {}) {
	return {
		registerTable: jest.fn(async () => undefined),
		getTablesMappingForContext: jest.fn(async () => ({
			files: "files",
			tasks: "tasks",
			tags: "tags",
			...tableMap,
		})),
	};
}

function createDocument() {
	return {
		createElement: jest.fn(() => ({
			innerHTML: "",
		})),
	};
}

describe("SQLSeal REST API execution", () => {
	beforeEach(() => {
		(global as any).document = createDocument();
	});

	afterEach(() => {
		delete (global as any).document;
	});

	it("preserves the plain SQL response shape and binds current-file frontmatter", async () => {
		const db = {
			select: jest.fn(async (_query: string, params: Record<string, unknown>) => ({
				columns: plainSqlResult.columns,
				data: [
					{
						title: params.title,
						date: params.date,
						parent: params.parent,
					},
				],
			})),
		};
		const rendererRegistry = createRendererRegistry();

		const response = await executeSqlSealRequest({
			app: createApp() as any,
			db: db as any,
			cellParser: { renderAsString: (value: unknown) => String(value ?? "") } as any,
			rendererRegistry: rendererRegistry as any,
			sync: createSync() as any,
			query: plainSqlQuery,
			file: dailyLedgerFile.path,
			variables: {},
		});

		expect(db.select).toHaveBeenCalledWith(
			plainSqlQuery,
			expect.objectContaining({
				...dailyLedgerFile.frontmatter,
				path: dailyLedgerFile.path,
				basename: dailyLedgerFile.basename,
				parent: dailyLedgerFile.parentPath,
			}),
		);
		expect(response).toEqual(expect.objectContaining({
			columns: plainSqlResult.columns,
			data: plainSqlResult.data,
			markdown: [
				"| title | date | parent |",
				"| :-- | :-- | :-- |",
				`| ${dailyLedgerFile.frontmatter.title} | ${dailyLedgerFile.frontmatter.date} | ${dailyLedgerFile.parentPath} |`,
			].join("\n"),
			renderer: "markdown",
		}));
		expect(rendererRegistry.prepareRender).toHaveBeenCalledWith("markdown", "");
	});

	it("executes CSV-backed TEMPLATE blocks through the codeblock parser pipeline", async () => {
		const db = {
			select: jest.fn(async () => sdlcTemplateResult),
		};
		const sync = createSync({
			gitlab_notes: "file_gitlab_notes",
			jira_events: "file_jira_events",
		});
		const rendererRegistry = createRendererRegistry();

		const response = await executeSqlSealRequest({
			app: createApp() as any,
			db: db as any,
			cellParser: { renderAsString: (value: unknown) => String(value ?? "") } as any,
			rendererRegistry: rendererRegistry as any,
			sync: sync as any,
			query: sdlcTemplateBlock,
			file: dailyLedgerFile.path,
			variables: {},
		});

		expect(sync.registerTable).toHaveBeenCalledTimes(2);
		expect(sync.registerTable).toHaveBeenCalledWith({
			type: "file",
			tableAlias: "jira_events",
			arguments: ["Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Data/jira_events.csv"],
			sourceFile: dailyLedgerFile.path,
		});
		expect(sync.registerTable).toHaveBeenCalledWith({
			type: "file",
			tableAlias: "gitlab_notes",
			arguments: ["Projects/Obligations/Indeed/Work Items/SDLC Bookkeeping/Data/gitlab_notes.csv"],
			sourceFile: dailyLedgerFile.path,
		});
		expect(db.select).toHaveBeenCalledWith(
			transformedSdlcTemplateQuery,
			expect.objectContaining({ date: dailyLedgerFile.frontmatter.date }),
		);
		expect(rendererRegistry.prepareRender).toHaveBeenCalledWith(
			"template",
			'missing=\'—\'\n{% include "_templates/sdlc-deltas.njk" %}',
		);
		expect(response).toEqual(expect.objectContaining({
			columns: sdlcTemplateResult.columns,
			data: sdlcTemplateResult.data,
			html: JSON.stringify({
				renderer: "template",
				options: 'missing=\'—\'\n{% include "_templates/sdlc-deltas.njk" %}',
				columns: sdlcTemplateResult.columns,
				rowCount: sdlcTemplateResult.data.length,
			}),
			renderer: "template",
			transformedQuery: transformedSdlcTemplateQuery,
			mappedTables: ["file_gitlab_notes", "file_jira_events"],
		}));
	});
});
