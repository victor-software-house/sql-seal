import { extractCodeBlocks, toDocPos } from './codeBlockExtraction'

describe('extractCodeBlocks', () => {
  it('extracts a regular sqlseal block', () => {
    const blocks = extractCodeBlocks('```sqlseal\nSELECT * FROM files\n```\n')

    expect(blocks).toEqual([{
      startIndex: 11,
      content: 'SELECT * FROM files\n',
    }])
  })

  it('ignores non-sqlseal fenced blocks', () => {
    expect(extractCodeBlocks('```sql\nSELECT 1\n```\n')).toEqual([])
  })

  it('extracts multiple regular sqlseal blocks', () => {
    const blocks = extractCodeBlocks([
      '```sqlseal',
      'SELECT 1',
      '```',
      '',
      '```sqlseal',
      'SELECT 2',
      '```',
    ].join('\n'))

    expect(blocks.map(block => block.content)).toEqual(['SELECT 1\n', 'SELECT 2\n'])
  })

  it('strips Obsidian callout prefixes before parsing block content', () => {
    const blocks = extractCodeBlocks('> ```sqlseal\n> TABLE x = file(a.csv)\n> SELECT * FROM x\n> ```\n')

    expect(blocks).toEqual([{
      startIndex: 13,
      content: 'TABLE x = file(a.csv)\nSELECT * FROM x\n',
      linePrefix: '> ',
    }])
  })

  it('handles nested callout prefixes', () => {
    const blocks = extractCodeBlocks('> > ```sqlseal\n> > SELECT 1\n> > ```\n')

    expect(blocks).toEqual([{
      startIndex: 15,
      content: 'SELECT 1\n',
      linePrefix: '> > ',
    }])
  })
})

describe('toDocPos', () => {
  it('maps regular block positions directly into the document', () => {
    expect(toDocPos('SELECT 1\n', '', 11, 7)).toBe(18)
  })

  it('adds one callout prefix for positions on the first content line', () => {
    expect(toDocPos('SELECT * FROM files\n', '> ', 13, 0)).toBe(15)
    expect(toDocPos('SELECT * FROM files\n', '> ', 13, 6)).toBe(21)
  })

  it('adds one callout prefix for each preceding content line', () => {
    expect(toDocPos('LINE1\nLINE2\n', '> ', 13, 6)).toBe(23)
  })

  it('uses the actual prefix length for nested callouts', () => {
    expect(toDocPos('SELECT 1\n', '> > ', 15, 0)).toBe(19)
  })
})
