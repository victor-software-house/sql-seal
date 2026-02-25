export interface MaterializeMarker {
    startPos: number;
    endPos: number;
    query: string;
    isExternalFile: boolean;
    queryEndPos: number;
    existingContentStartPos: number;
    existingContentEndPos: number;
    existingContent: string;
    updatedTimestamp?: string;
}

export function parseMaterializeMarkers(text: string): MaterializeMarker[] {
    const markers: MaterializeMarker[] = [];
    
    const startRegex = /<!--\s*sqlseal(-file)?:\s*([\s\S]*?)\s*-->/g;
    const updatedRegex = /<!--\s*sqlseal-updated:\s*([^>]+?)\s*-->/g;
    const endRegex = /<!--\s*\/sqlseal\s*-->/g;

    let startMatch;
    while ((startMatch = startRegex.exec(text)) !== null) {
        const startPos = startMatch.index;
        const isExternalFile = startMatch[1] === '-file';
        const queryOrFile = startMatch[2].trim();
        
        const queryEndPos = startRegex.lastIndex;
        
        endRegex.lastIndex = queryEndPos;
        const endMatch = endRegex.exec(text);
        
        if (!endMatch) {
            continue;
        }
        
        const endPos = endMatch.index + endMatch[0].length;
        
        let updatedTimestamp: string | undefined;
        let existingContentStartPos = queryEndPos;
        
        updatedRegex.lastIndex = queryEndPos;
        const updatedMatch = updatedRegex.exec(text);
        
        if (updatedMatch && updatedMatch.index < endMatch.index) {
            updatedTimestamp = updatedMatch[1].trim();
            existingContentStartPos = updatedMatch.index + updatedMatch[0].length;
        }
        
        const existingContentEndPos = endMatch.index;
        const existingContent = text.substring(existingContentStartPos, existingContentEndPos);
        
        markers.push({
            startPos,
            endPos,
            query: queryOrFile,
            isExternalFile,
            queryEndPos,
            existingContentStartPos,
            existingContentEndPos,
            existingContent,
            updatedTimestamp
        });
        
        startRegex.lastIndex = endPos;
    }
    
    return markers;
}
