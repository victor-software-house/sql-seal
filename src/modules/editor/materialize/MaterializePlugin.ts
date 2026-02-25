import { App, Plugin, TFile } from "obsidian";
import { Materializer } from "./materializer";
import { SqlSealDatabase } from "../../database/database";
import { ModernCellParser } from "../../syntaxHighlight/cellParser/ModernCellParser";
import { Sync } from "../../sync/sync/sync";
import { debounce } from "obsidian";
import { createMaterializeEditPlugin } from "./ui/editWidget";

export class MaterializePlugin {
    private materializer: Materializer;
    private debouncers = new Map<string, () => void>();

    constructor(
        private app: App,
        private plugin: Plugin,
        private db: SqlSealDatabase,
        private cellParser: ModernCellParser,
        private sync: Sync
    ) {
        this.materializer = new Materializer(app, db, cellParser, sync);
        this.plugin.registerEditorExtension(createMaterializeEditPlugin(app));
    }

    public async onload() {
        this.scanAndMaterializeAll();

        this.plugin.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.materializer.isSelfTriggered(file.path)) {
                        return;
                    }
                    this.queueProcessFile(file);
                }
            })
        );

        this.plugin.addCommand({
            id: 'sqlseal-materialize-all',
            name: 'Materialize all queries',
            callback: () => this.scanAndMaterializeAll(true)
        });

        this.plugin.addCommand({
            id: 'sqlseal-materialize-current',
            name: 'Materialize queries in current file',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    this.materializer.processFile(activeFile, true);
                }
            }
        });
    }

    private queueProcessFile(file: TFile) {
        let processFn = this.debouncers.get(file.path);
        if (!processFn) {
            processFn = debounce(() => {
                this.materializer.processFile(file);
            }, 2000, true);
            this.debouncers.set(file.path, processFn);
        }
        processFn();
    }

    private async scanAndMaterializeAll(force: boolean = false) {
        const mdFiles = this.app.vault.getMarkdownFiles();
        for (const file of mdFiles) {
            const content = await this.app.vault.cachedRead(file);
            if (content.includes('<!-- sqlseal:') || content.includes('<!-- sqlseal-file:')) {
                if (force) {
                    this.materializer.processFile(file, true);
                } else {
                    this.queueProcessFile(file);
                }
            }
        }
    }

    public onunload() {
        this.materializer.cleanup();
        this.debouncers.clear();
    }
}
