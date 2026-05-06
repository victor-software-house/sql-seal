import { App, Plugin } from "obsidian";
import { SqlSealDatabase } from "../database/database";
import { ModernCellParser } from "../../modules/syntaxHighlight/cellParser/ModernCellParser";
import { ParseResults } from "../../modules/syntaxHighlight/cellParser/parseResults";
import { RendererRegistry } from "../editor/renderer/rendererRegistry";
import { ParserResult, parseWithDefaults } from "../editor/parser";
import { transformQuery } from "../editor/sql/sqlTransformer";
import { Sync } from "../sync/sync/sync";

// Mirrors the public surface of obsidian-local-rest-api without importing it
interface LocalRestApiPlugin {
	getPublicApi(manifest: any): LocalRestApiPublicApi;
}

interface LocalRestApiPublicApi {
	addRoute(path: string): {
		get(handler: (req: any, res: any) => void): any;
		post(handler: (req: any, res: any) => void): any;
	};
	unregister(): void;
}

function getApi(app: App, manifest: any): LocalRestApiPublicApi | undefined {
	const plugin = (app as any).plugins?.plugins?.["obsidian-local-rest-api"] as LocalRestApiPlugin | undefined;
	return plugin?.getPublicApi(manifest);
}

function buildBindVars(
	file: { path: string; basename: string; parent: string },
	frontmatter: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...frontmatter,
		path: file.path,
		basename: file.basename,
		parent: file.parent,
		fileName: file.path.split("/").pop() ?? "",
		extension: "md",
	};
}

function markdownTable(columns: string[], rows: Record<string, unknown>[]): string {
	const header = `| ${columns.join(" | ")} |`;
	const sep = `| ${columns.map(() => ":--").join(" | ")} |`;
	const body = rows.map(row => `| ${columns.map(c => row[c] ?? "").join(" | ")} |`);
	return [header, sep, ...body].join("\n");
}

function renderHtml(
	rendererRegistry: RendererRegistry,
	renderer: ParserResult["renderer"],
	cellParser: ModernCellParser,
	sourcePath: string,
	data: Record<string, unknown>[],
	columns: string[],
	flags: ParserResult["flags"],
	frontmatter: Record<string, unknown>,
): string {
	const el = document.createElement("div");
	const render = rendererRegistry.prepareRender(
		renderer.type.toLowerCase(),
		renderer.options,
	)(el, { cellParser, sourcePath });

	try {
		render.render({ data, columns, flags, frontmatter });
		return el.innerHTML;
	} finally {
		render.cleanup?.();
	}
}

interface ExecuteSqlSealRequest {
	app: App;
	db: SqlSealDatabase;
	cellParser: ModernCellParser;
	rendererRegistry: RendererRegistry;
	sync: Sync;
	query: string;
	file?: string;
	variables?: Record<string, unknown>;
}

export async function executeSqlSealRequest({
	app,
	db,
	cellParser,
	rendererRegistry,
	sync,
	query,
	file,
	variables = {},
}: ExecuteSqlSealRequest): Promise<Record<string, unknown>> {
	const defaults: ParserResult = {
		flags: {
			refresh: false,
			explain: false,
		},
		query: "",
		renderer: {
			options: "",
			type: "MARKDOWN",
		},
		tables: [],
	};

	const parsed = parseWithDefaults(
		query,
		rendererRegistry.getViewDefinitions(),
		defaults,
		rendererRegistry.flags,
	);

	let bindVars: Record<string, unknown> = variables;
	let sourcePath = "/";

	if (file && typeof file === "string") {
		const tFile = app.vault.getFileByPath(file);
		if (tFile) {
			sourcePath = tFile.path;
			const fm = app.metadataCache.getFileCache(tFile)?.frontmatter ?? {};
			bindVars = buildBindVars(
				{
					path: tFile.path,
					basename: tFile.basename,
					parent: tFile.parent?.path ?? "",
				},
				{ ...fm, ...bindVars },
			);
		}
	}

	if (parsed.tables.length) {
		await Promise.all(
			parsed.tables.map((table) =>
				sync.registerTable({
					...table,
					sourceFile: sourcePath,
				}),
			),
		);
	}

	if (!parsed.query) {
		return {
			columns: [],
			data: [],
			markdown: "",
			html: "",
			renderer: parsed.renderer.type.toLowerCase(),
			tables: parsed.tables.map((table) => table.tableAlias),
		};
	}

	const registeredTablesForContext = await sync.getTablesMappingForContext(sourcePath);
	const transformed = transformQuery(parsed.query, registeredTablesForContext);
	const result = await db.select(transformed.sql, bindVars);

	if (!result) {
		throw new Error("query execution failed");
	}

	const { data, columns } = result;
	const rendered = new ParseResults(cellParser).renderAsString(data, columns);
	const response: Record<string, unknown> = {
		columns,
		data: rendered,
		markdown: markdownTable(columns, rendered),
		html: renderHtml(
			rendererRegistry,
			parsed.renderer,
			cellParser,
			sourcePath,
			data,
			columns,
			parsed.flags,
			bindVars,
		),
		renderer: parsed.renderer.type.toLowerCase(),
		query: parsed.query,
		transformedQuery: transformed.sql,
		mappedTables: transformed.mappedTables,
	};

	if (parsed.flags.explain) {
		response.explain = await db.explain(transformed.sql, bindVars);
	}

	return response;
}

export function registerRestApi(
	app: App,
	plugin: Plugin,
	db: SqlSealDatabase,
	cellParser: ModernCellParser,
	rendererRegistry: RendererRegistry,
	sync: Sync,
): void {
	const register = () => {
		const api = getApi(app, plugin.manifest);
		if (!api) return;

		plugin.register(() => api.unregister());

		api.addRoute("/sqlseal/query").post(async (req: any, res: any) => {
			try {
				const { query, file, variables } = req.body ?? {};

				if (!query || typeof query !== "string") {
					res.status(400).json({ error: "query field required (SQLSeal block or SQL string)" });
					return;
				}

				if (variables !== undefined && (variables === null || typeof variables !== "object" || Array.isArray(variables))) {
					res.status(400).json({ error: "variables must be an object when provided" });
					return;
				}

				res.json(await executeSqlSealRequest({
					app,
					db,
					cellParser,
					rendererRegistry,
					sync,
					query,
					file,
					variables,
				}));
			} catch (e: any) {
				res.status(500).json({ error: e.message ?? String(e) });
			}
		});
	};

	// obsidian-local-rest-api loads before sqlseal alphabetically, so it is
	// available immediately. The workspace event is a safety net for edge cases
	// (e.g. plugin load order changes, deferred enable).
	register();
	const ref = app.workspace.on("obsidian-local-rest-api:loaded" as any, register);
	plugin.registerEvent(ref);
}
