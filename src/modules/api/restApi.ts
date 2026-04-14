import { App, Plugin } from "obsidian";
import { SqlSealDatabase } from "../database/database";
import { ModernCellParser } from "../../modules/syntaxHighlight/cellParser/ModernCellParser";
import { ParseResults } from "../../modules/syntaxHighlight/cellParser/parseResults";

interface LocalRestApiPublicApi {
	addRoute(path: string): {
		get(handler: (req: any, res: any) => void): any;
		post(handler: (req: any, res: any) => void): any;
	};
	unregister(): void;
}

type GetApiFn = (app: App, manifest: any) => LocalRestApiPublicApi | undefined;

function getLocalRestApi(app: App): GetApiFn | undefined {
	const plugin = (app as any).plugins?.plugins?.["obsidian-local-rest-api"];
	if (!plugin?.getPublicApi) return undefined;
	return (a: App, manifest: any) => plugin.getPublicApi(manifest);
}

function buildBindVariables(file: { path: string; basename: string; parent: string }, frontmatter: Record<string, unknown>): Record<string, unknown> {
	return {
		...frontmatter,
		path: file.path,
		basename: file.basename,
		parent: file.parent,
		fileName: file.path.split("/").pop() ?? "",
		extension: "md",
	};
}

export function registerRestApi(
	app: App,
	plugin: Plugin,
	db: SqlSealDatabase,
	cellParser: ModernCellParser,
): void {
	const getAPI = getLocalRestApi(app);
	if (!getAPI) return;

	const api = getAPI(app, plugin.manifest);
	if (!api) return;

	plugin.register(() => api.unregister());

	// POST /sqlseal/query
	// Body: { query: string, file?: string, variables?: Record<string, unknown> }
	// Returns: { columns: string[], data: Record<string, string>[], markdown: string }
	const queryRoute = api.addRoute("/sqlseal/query");
	queryRoute.post(async (req: any, res: any) => {
		try {
			const { query, file, variables } = req.body ?? {};

			if (!query || typeof query !== "string") {
				res.status(400).json({ error: "query field required (SQL string)" });
				return;
			}

			// Build bind variables from file context or explicit variables
			let bindVars: Record<string, unknown> = variables ?? {};

			if (file && typeof file === "string") {
				const tFile = app.vault.getFileByPath(file);
				if (tFile) {
					const cache = app.metadataCache.getFileCache(tFile);
					const parentPath = tFile.parent?.path ?? "";
					bindVars = buildBindVariables(
						{ path: tFile.path, basename: tFile.basename, parent: parentPath },
						{ ...(cache?.frontmatter ?? {}), ...bindVars },
					);
				}
			}

			const result = await db.select(query, bindVars);
			if (!result) {
				res.status(500).json({ error: "query execution failed" });
				return;
			}

			const { data, columns } = result;

			// Render as markdown strings (wikilinks, plain values)
			const parser = new ParseResults(cellParser);
			const rendered = parser.renderAsString(data, columns);

			// Build a markdown table
			const mdHeader = `| ${columns.join(" | ")} |`;
			const mdSep = `| ${columns.map(() => ":--").join(" | ")} |`;
			const mdRows = rendered.map(
				(row) => `| ${columns.map((c) => row[c] ?? "").join(" | ")} |`,
			);
			const markdown = [mdHeader, mdSep, ...mdRows].join("\n");

			res.json({ columns, data: rendered, markdown });
		} catch (e: any) {
			res.status(500).json({ error: e.message ?? String(e) });
		}
	});
}
