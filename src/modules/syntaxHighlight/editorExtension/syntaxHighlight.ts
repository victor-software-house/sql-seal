import {
  App
} from 'obsidian';
import * as ohm from 'ohm-js';

import {
  ViewUpdate,
  PluginValue,
  EditorView,
  Decoration,
  DecorationSet
} from '@codemirror/view';

import { Range } from '@codemirror/state';
import { Decorator, highlighterOperation } from '../grammar/highlighterOperation';
import { FilePathWidget } from './widgets/FilePathWidget';
import { RendererRegistry } from '../../editor/renderer/rendererRegistry';
import { SQLSealLangDefinition } from '../../editor/parser';
import { CodeBlockMatch, extractCodeBlocks, toDocPos } from './codeBlockExtraction';

const markDecorations = {
  blockFlag: Decoration.mark({ class: 'cm-sqlseal-block-flag' }),
  blockQuery: Decoration.mark({ class: 'cm-sqlseal-block-query' }),
  blockView: Decoration.mark({ class: 'cm-sqlseal-block-view' }),
  blockTable: Decoration.mark({ class: 'cm-sqlseal-block-table' }),
  identifier: Decoration.mark({ class: 'cm-sqlseal-identifier' }),
  literal: Decoration.mark({ class: 'cm-sqlseal-literal' }),
  number: Decoration.mark({ class: 'cm-sqlseal-literal' }),
  string: Decoration.mark({ class: 'cm-sqlseal-literal' }),
  parameter: Decoration.mark({ class: 'cm-sqlseal-parameter' }),
  comment: Decoration.mark({ class: 'cm-sqlseal-comment' }),
  keyword: Decoration.mark({ class: 'cm-sqlseal-keyword' }),
  'template-keyword': Decoration.mark({ class: 'cm-sqlseal-template-keyword' }),
  function: Decoration.mark({ class: 'cm-sqlseal-function' }),
  error: Decoration.mark({ class: "cm-sqlseal-error" })
};

export class SQLSealViewPlugin implements PluginValue {
  decorations: DecorationSet;
  private readonly app: App;
  private readonly renderers: RendererRegistry;

  constructor(view: EditorView, app: App, renderers: RendererRegistry, private allIsCode: boolean) {
    this.app = app;
    this.renderers = renderers;
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  destroy(): void { }

  private parseWithGrammar(sql: string): Decorator[] {
    const grammar = ohm.grammar(SQLSealLangDefinition(this.renderers.getViewDefinitions(), this.renderers.flags, true));

    // FIXME: extend grammar with error line.

    const match = grammar.match(sql)
    if (match.failed()) {
      return []
    }
    const highlight = highlighterOperation(grammar)(match)

    const results = highlight.highlight()

    return results
  }

  private getCodeBlocks(view: EditorView): CodeBlockMatch[] {
    const text = view.state.doc.toString();
    if (this.allIsCode) {
      return [{
        startIndex: 0,
        content: text
      }]
    }

    return extractCodeBlocks(text)
  }

  decorateFilename(dec: Decorator, { content, startIndex, linePrefix }: CodeBlockMatch) {
    let hasQuotes = false;
    // Get the actual filename text from the document
    let filePath = content.slice(dec.start, dec.end)

    // Remove leading & trailing quotes, if captured.
    if (filePath.startsWith('"')) {
      filePath = filePath.substring(1, filePath.length - 1)
      hasQuotes = true;
    }

    // Create widget decoration for the filename
    const widget = new FilePathWidget(filePath, this.app);
    return Decoration.replace({
      widget,
      inclusive: true
    }).range(
      toDocPos(content, linePrefix || '', startIndex, dec.start + Number(hasQuotes)),
      toDocPos(content, linePrefix || '', startIndex, dec.end - Number(hasQuotes))
    )
  }

  privateDecorateCodeblock(codeblockMatch: CodeBlockMatch): Array<Range<Decoration>> {
      const { content, startIndex, linePrefix } = codeblockMatch
      const decorations = this.parseWithGrammar(content);
        return (decorations || []).flatMap(dec => {
          switch (dec.type) {
            case 'filename':
              return this.decorateFilename(dec, codeblockMatch)
            default:
              const decoration = markDecorations[dec.type as keyof typeof markDecorations];
            if (decoration) {
              return decoration.range(
                toDocPos(content, linePrefix || '', startIndex, dec.start),
                toDocPos(content, linePrefix || '', startIndex, dec.end)
              )
            } else {
              return []
            }
          }
        });
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const results = this.getCodeBlocks(view)
    const decorators = results.flatMap(r => this.privateDecorateCodeblock(r))

    return Decoration.set(decorators, true);
  }
}
