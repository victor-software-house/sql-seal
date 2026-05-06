import { getMarkdownTable } from "markdown-table-ts";
import { App, MarkdownRenderer as ObsidianMarkdownRenderer } from "obsidian";
import { RendererConfig, RendererContext } from "./rendererRegistry";
import { displayError } from "../../../utils/ui";
import { ViewDefinition } from "../parser";
import { ParseResults } from "../../syntaxHighlight/cellParser/parseResults";
import nunjucks from "nunjucks";
import { VaultLoader } from "./VaultLoader";

interface MarkdownDirectives {
    missing: string | null;
    blank: string | null;
}

interface MarkdownRendererConfig {
    template: nunjucks.Template | null;
    directives: MarkdownDirectives;
}

const DIRECTIVE_RE = /^(missing|blank)\s*=\s*['"](.+?)['"]\s*$/gm;
const NESTED_SQLSEAL_FENCE_RE = /^\s*(```|~~~)\s*sqlseal\b/im;

function registerFilters(env: nunjucks.Environment): void {
    env.addFilter("groupby", (arr: any[], key: string) => {
        const groups: Record<string, any[]> = {};
        for (const item of arr) {
            const groupKey = String(item[key] ?? "");
            groups[groupKey] ??= [];
            groups[groupKey].push(item);
        }
        return Object.entries(groups).map(([k, items]) => ({
            grouper: k,
            list: items,
        }));
    });

    env.addFilter("unique", (arr: any[], key?: string) => {
        if (!key) return [...new Set(arr)];
        const seen = new Set<string>();
        return arr.filter((item) => {
            const val = String(item[key] ?? "");
            if (seen.has(val)) return false;
            seen.add(val);
            return true;
        });
    });
}

function parseDirectives(config: string): { directives: MarkdownDirectives; templateSource: string } {
    const directives: MarkdownDirectives = { missing: null, blank: null }
    const templateSource = config.replace(DIRECTIVE_RE, (_, key, value) => {
        directives[key as keyof MarkdownDirectives] = value
        return ''
    }).trimStart()
    return { directives, templateSource }
}

function isBlank(v: unknown): boolean {
    return v == null || String(v).trim().length === 0
}

function applyDirectives(data: Record<string, any>[], directives: MarkdownDirectives): Record<string, any>[] {
    if (!directives.missing && !directives.blank) return data
    return data.map(row => {
        const out: Record<string, any> = {}
        for (const [k, v] of Object.entries(row)) {
            if (v == null && directives.missing) {
                out[k] = directives.missing
            } else if (isBlank(v) && directives.blank) {
                out[k] = directives.blank
            } else {
                out[k] = v
            }
        }
        return out
    })
}

function markdownTable(columns: string[], data: Record<string, any>[]) {
    return getMarkdownTable({
        table: {
            head: columns,
            body: data.map(d => columns.map(c => String(d[c] ?? '')))
        }
    })
}

function assertNoNestedSqlSealFence(markdown: string): void {
    if (NESTED_SQLSEAL_FENCE_RE.test(markdown)) {
        throw new Error("MARKDOWN renderer output cannot contain nested sqlseal fenced codeblocks")
    }
}

export class MarkdownRenderer implements RendererConfig {
    private readonly env: nunjucks.Environment;

    constructor(
        private readonly app: App,
        loader?: VaultLoader,
    ) {
        this.env = new nunjucks.Environment(
            loader ?? null,
            { autoescape: false },
        );
        registerFilters(this.env);
    }

    get rendererKey() {
        return 'markdown'
    }

    get viewDefinition(): ViewDefinition {
        return {
            name: this.rendererKey,
            argument: 'nunjucksTemplate?',
            singleLine: false
        }
    }

    validateConfig(config: string): MarkdownRendererConfig {
        const { directives, templateSource } = parseDirectives(config)
        assertNoNestedSqlSealFence(templateSource)

        return {
            template: templateSource ? nunjucks.compile(templateSource, this.env) : null,
            directives,
        }
    }

    render(config: MarkdownRendererConfig, el: HTMLElement, { cellParser, component, sourcePath } : RendererContext) {
        if (!component) {
            throw new Error("MARKDOWN renderer requires a rendering component")
        }

        const parseResult = new ParseResults(cellParser!)
        return {
            render: async ({ columns, data, frontmatter }: any) => {
                const parsed = applyDirectives(
                    parseResult.renderAsString(data, columns),
                    config.directives,
                )

                const markdown = config.template
                    ? config.template.render({
                        data: parsed,
                        columns,
                        properties: frontmatter,
                    })
                    : markdownTable(columns, parsed)

                assertNoNestedSqlSealFence(markdown)
                el.empty()
                await ObsidianMarkdownRenderer.render(
                    this.app,
                    markdown,
                    el,
                    sourcePath,
                    component,
                )

            },
            error: (error: string) => {
                displayError(el, error)
            }
        }
    }
}
