export interface CodeBlockMatch {
  startIndex: number,
  content: string,
  linePrefix?: string
}

export function extractCodeBlocks(text: string): CodeBlockMatch[] {
  const codeBlockRegex = /^([ \t]*(?:>[ \t]?)*)(```)(sqlseal)\n([\s\S]*?)^[ \t]*(?:>[ \t]?)*```/gm
  const results: CodeBlockMatch[] = []
  let match

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const linePrefix = match[1] || ''
    const fence = match[2]
    const langTag = match[3]
    const rawContent = match[4]
    const contentStart = match.index + linePrefix.length + fence.length + langTag.length + 1

    if (!linePrefix) {
      results.push({ startIndex: contentStart, content: rawContent })
      continue
    }

    const content = rawContent
      .split('\n')
      .map(line => line.startsWith(linePrefix) ? line.slice(linePrefix.length) : line)
      .join('\n')

    results.push({ startIndex: contentStart, content, linePrefix })
  }

  return results
}

export function toDocPos(
  content: string,
  linePrefix: string,
  startIndex: number,
  posInContent: number
): number {
  if (!linePrefix) return startIndex + posInContent

  const lineCount = (content.slice(0, posInContent).match(/\n/g) || []).length
  return startIndex + posInContent + ((lineCount + 1) * linePrefix.length)
}
