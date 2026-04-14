import { App, Plugin } from "obsidian";
import { SqlSealDatabase } from "../database/database";
import { ModernCellParser } from "../../modules/syntaxHighlight/cellParser/ModernCellParser";
import { ParseResults } from "../../modules/syntaxHighlight/cellParser/parseResults";

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

export function registerRestApi(
	app: App,
	plugin: Plugin,
	db: SqlSealDatabase,
	cellParser: ModernCellParser,
): void {
	const register = () => {
		const api = getApi(app, plugin.manifest);
		if (!api) return;

		plugin.register(() => api.unregister());

		api.addRoute("/sqlseal/query").post(async (req: any, res: any) => {
			try {
				const { query, file, variables } = req.body ?? {};

				if (!query || typeof query !== "string") {
					res.status(400).json({ error: "query field required (SQL string)" });
					return;
				}

				let bindVars: Record<string, unknown> = variables ?? {};

				if (file && typeof file === "string") {
					const tFile = app.vault.getFileByPath(file);
					if (tFile) {
						const fm = app.metadataCache.getFileCache(tFile)?.frontmatter ?? {};
						bindVars = buildBindVars(
							{ path: tFile.path, basename: tFile.basename, parent: tFile.parent?.path ?? "" },
							{ ...fm, ...bindVars },
						);
					}
				}

				const result = await db.select(query, bindVars);
				if (!result) {
					res.status(500).json({ error: "query execution failed" });
					return;
				}

				const { data, columns } = result;
				const rendered = new ParseResults(cellParser).renderAsString(data, columns);

				const header = `| ${columns.join(" | ")} |`;
				const sep    = `| ${columns.map(() => ":--").join(" | ")} |`;
				const rows   = rendered.map(row => `| ${columns.map(c => row[c] ?? "").join(" | ")} |`);
				const markdown = [header, sep, ...rows].join("\n");

				res.json({ columns, data: rendered, markdown });
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
