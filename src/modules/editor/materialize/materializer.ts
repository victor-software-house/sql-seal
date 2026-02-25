import { App, TFile } from "obsidian";
import { SqlSealDatabase } from "../../database/database";
import { parseMaterializeMarkers, MaterializeMarker } from "./markerParser";
import { ModernCellParser } from "../../syntaxHighlight/cellParser/ModernCellParser";
import { ParseResults } from "../../syntaxHighlight/cellParser/parseResults";
import { getMarkdownTable } from "markdown-table-ts";
import { transformQuery } from "../sql/sqlTransformer";
import { Sync } from "../../sync/sync/sync";
import { OmnibusRegistrator } from "@hypersphere/omnibus";
import { registerObservers } from "../../../utils/registerObservers";

const mapDataFromHeaders = (cols: string[], rowsData: Record<string, any>[]) => {
    return rowsData.map(d => cols.map(c => String(d[c])));
};

export class Materializer {
    private registratorMap = new Map<string, OmnibusRegistrator>();
    private pendingProcess = new Set<string>();
    private selfWrittenPaths = new Set<string>();

    constructor(
        private app: App,
        private db: SqlSealDatabase,
        private cellParser: ModernCellParser,
        private sync: Sync
    ) {}

    isSelfTriggered(path: string): boolean {
        if (this.selfWrittenPaths.has(path)) {
            this.selfWrittenPaths.delete(path);
            return true;
        }
        return false;
    }

    async processFile(file: TFile, forceRefresh: boolean = false): Promise<boolean> {
        if (this.pendingProcess.has(file.path)) {
            return false;
        }

        this.pendingProcess.add(file.path);
        
        try {
            const data = await this.app.vault.read(file);
            const markers = parseMaterializeMarkers(data);
            if (markers.length === 0) {
                this.unregisterFile(file.path);
                return false;
            }

            const registeredTablesForContext = await this.sync.getTablesMappingForContext(file.path);
            
            const fileCache = this.app.metadataCache.getFileCache(file);
            const variables = {
                ...(fileCache?.frontmatter ?? {}),
                path: file.path,
                fileName: file.name,
                basename: file.basename,
                parent: file.parent?.path,
                extension: file.extension,
            };

            let changed = false;
            const newContents = new Map<number, string>();
            const subscribedTables = new Set<string>();

            for (let i = markers.length - 1; i >= 0; i--) {
                const marker = markers[i];
                let query = marker.query;

                if (marker.isExternalFile) {
                    const extFile = this.app.vault.getAbstractFileByPath(query);
                    if (extFile && extFile instanceof TFile) {
                        query = await this.app.vault.read(extFile);
                    } else {
                        const newBlockContent = `\n_Error: File not found: ${query}_\n`;
                        newContents.set(i, newBlockContent);
                        if (marker.existingContent !== newBlockContent) changed = true;
                        continue;
                    }
                }

                query = query.replace(/&#45;&#45;/g, '--');

                const res = transformQuery(query, registeredTablesForContext);
                const transformedQuery = res.sql;

                res.mappedTables.forEach(t => subscribedTables.add(t));

                try {
                    const result = await this.db.select(transformedQuery, variables);
                    if (!result) {
                        continue;
                    }
                    const { data: rows, columns } = result;

                    const parseResult = new ParseResults(this.cellParser);
                    const parsedData = parseResult.renderAsString(rows, columns);

                    const tab = getMarkdownTable({
                        table: {
                            head: columns,
                            body: mapDataFromHeaders(columns, parsedData)
                        }
                    });

                    if (!forceRefresh && marker.existingContent.trim() === tab.trim()) {
                        continue;
                    }

                    const updatedTimestamp = new Date().toISOString();
                    const newBlockContent = `\n<!-- sqlseal-updated: ${updatedTimestamp} -->\n\n${tab}\n`;
                    newContents.set(i, newBlockContent);
                    changed = true;
                } catch (e: any) {
                    const newBlockContent = `\n_Error: ${e.message}_\n`;
                    newContents.set(i, newBlockContent);
                    if (marker.existingContent.trim() !== newBlockContent.trim()) changed = true;
                }
            }
            
            let registrator = this.registratorMap.get(file.path);
            if (!registrator) {
                registrator = this.sync.getRegistrator();
                this.registratorMap.set(file.path, registrator);
            } else {
                registrator.offAll();
            }

            if (subscribedTables.size > 0) {
                registerObservers({
                    bus: registrator,
                    callback: () => this.processFile(file),
                    fileName: file.path,
                    tables: Array.from(subscribedTables)
                });
            } else {
                this.unregisterFile(file.path);
            }

            if (changed) {
                this.selfWrittenPaths.add(file.path);
                await this.app.vault.process(file, (currentData) => {
                    const freshMarkers = parseMaterializeMarkers(currentData);
                    if (freshMarkers.length !== markers.length) {
                        this.selfWrittenPaths.delete(file.path);
                        return currentData;
                    }

                    let finalData = currentData;
                    for (let i = freshMarkers.length - 1; i >= 0; i--) {
                        const marker = freshMarkers[i];
                        const newContent = newContents.get(i);
                        if (newContent !== undefined) {
                            finalData = this.replaceBlockContent(finalData, marker, newContent);
                        }
                    }
                    return finalData;
                });
                return true;
            }

            return false;

        } finally {
            this.pendingProcess.delete(file.path);
        }
    }

    private unregisterFile(path: string) {
        const registrator = this.registratorMap.get(path);
        if (registrator) {
            registrator.offAll();
            this.registratorMap.delete(path);
        }
    }

    public cleanup() {
        this.registratorMap.forEach(reg => reg.offAll());
        this.registratorMap.clear();
        this.pendingProcess.clear();
        this.selfWrittenPaths.clear();
    }

    private replaceBlockContent(text: string, marker: MaterializeMarker, newContent: string): string {
        const pre = text.substring(0, marker.queryEndPos);
        const post = text.substring(marker.existingContentEndPos);
        return pre + newContent + post;
    }
}
