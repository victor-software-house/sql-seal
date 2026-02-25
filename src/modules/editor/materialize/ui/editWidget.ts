import { EditorView, WidgetType, Decoration, DecorationSet, ViewUpdate, ViewPlugin, PluginValue } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { parseMaterializeMarkers } from "../markerParser";
import { App, Modal, Setting } from "obsidian";

class EditQueryModal extends Modal {
    query: string;
    onSave: (newQuery: string) => void;
    private resultEl: HTMLElement;

    constructor(app: App, query: string, onSave: (newQuery: string) => void) {
        super(app);
        this.query = query;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Edit SQLSeal Query" });

        new Setting(contentEl)
            .setName("Query")
            .setDesc("Edit the SQL query for this materialized block")
            .addTextArea((text) => {
                text.setValue(this.query);
                text.onChange((value) => {
                    this.query = value;
                });
                text.inputEl.rows = 10;
                text.inputEl.cols = 50;
                text.inputEl.style.width = "100%";
                text.inputEl.style.fontFamily = "monospace";
            });

        this.resultEl = contentEl.createDiv({ cls: "sqlseal-materialize-preview" });
        this.resultEl.style.maxHeight = "200px";
        this.resultEl.style.overflow = "auto";
        this.resultEl.style.marginBottom = "8px";
        this.resultEl.style.fontFamily = "monospace";
        this.resultEl.style.fontSize = "0.85em";
        this.resultEl.style.whiteSpace = "pre-wrap";
        this.resultEl.style.display = "none";

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Run")
                    .onClick(() => {
                        this.resultEl.style.display = "block";
                        this.resultEl.setText("Preview is not available in the editor modal. Save to materialize.");
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Save")
                    .setCta()
                    .onClick(() => {
                        this.onSave(this.query);
                        this.close();
                    })
            )
            .addButton((btn) =>
                btn.setButtonText("Cancel").onClick(() => {
                    this.close();
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class EditWidget extends WidgetType {
    constructor(
        private app: App,
        private query: string,
        private queryCommentStart: number,
        private queryCommentEnd: number,
        private isExternalFile: boolean
    ) {
        super();
    }

    eq(other: EditWidget) {
        return other.query === this.query &&
            other.queryCommentStart === this.queryCommentStart &&
            other.queryCommentEnd === this.queryCommentEnd;
    }

    toDOM(view: EditorView): HTMLElement {
        const span = document.createElement("span");
        span.className = "sqlseal-materialize-edit-widget";
        span.setAttribute("aria-label", "Edit Query");
        
        span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
        
        span.style.cursor = "pointer";
        span.style.color = "var(--text-muted)";
        span.style.marginLeft = "4px";
        span.style.verticalAlign = "middle";

        span.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isExternalFile) {
                const file = this.app.vault.getAbstractFileByPath(this.query);
                if (file) {
                    this.app.workspace.getLeaf(true).openFile(file as any);
                }
                return;
            }

            new EditQueryModal(this.app, this.query, (newQuery) => {
                view.dispatch({
                    changes: {
                        from: this.queryCommentStart,
                        to: this.queryCommentEnd,
                        insert: `<!-- sqlseal: ${newQuery} -->`
                    }
                });
            }).open();
        });

        return span;
    }
}

export function createMaterializeEditPlugin(app: App) {
    return ViewPlugin.fromClass(class implements PluginValue {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>();
            
            for (const {from, to} of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                const markers = parseMaterializeMarkers(text);
                
                for (const marker of markers) {
                    const widgetPos = from + marker.queryEndPos;
                    builder.add(
                        widgetPos,
                        widgetPos,
                        Decoration.widget({
                            widget: new EditWidget(
                                app,
                                marker.query,
                                from + marker.startPos,
                                from + marker.queryEndPos,
                                marker.isExternalFile
                            ),
                            side: 1
                        })
                    );
                }
            }

            return builder.finish();
        }
    }, {
        decorations: v => v.decorations
    });
}
