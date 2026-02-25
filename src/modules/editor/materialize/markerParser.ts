export interface MaterializeMarker {
    startPos: number;
    endPos: number;
    query: string;
    isExternalFile: boolean;
    existingContentStartPos: number;
    existingContentEndPos: number;
    existingContent: string;
    updatedTimestamp?: string;
}

export function parseMaterializeMarkers(text: string): MaterializeMarker[] {
    const markers: MaterializeMarker[] = [];
    
    // Regular expression to find the start marker: <!-- sqlseal: ... --> or <!-- sqlseal-file: ... -->
    const startRegex = /<!--\s*sqlseal(-file)?:\s*([\s\S]*?)\s*-->/g;
    
    // Regex for updated timestamp: <!-- sqlseal-updated: ... -->
    const updatedRegex = /<!--\s*sqlseal-updated:\s*([^>]+?)\s*-->/g;
    
    // Regex for end sentinel: <!-- /sqlseal -->
    const endRegex = /<!--\s*\/sqlseal\s*-->/g;

    let startMatch;
    while ((startMatch = startRegex.exec(text)) !== null) {
        const startPos = startMatch.index;
        const isExternalFile = startMatch[1] === '-file';
        const queryOrFile = startMatch[2].trim();
        
        const contentStartPos = startRegex.lastIndex;
        
        // Find the matching end marker
        endRegex.lastIndex = contentStartPos;
        const endMatch = endRegex.exec(text);
        
        if (!endMatch) {
            // No end marker found, skip this block
            continue;
        }
        
        const endPos = endMatch.index + endMatch[0].length;
        
        // Now look for updated timestamp between start and end
        let updatedTimestamp: string | undefined;
        let existingContentStartPos = contentStartPos;
        
        updatedRegex.lastIndex = contentStartPos;
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
            existingContentStartPos,
            existingContentEndPos,
            existingContent,
            updatedTimestamp
        });
        
        // Advance startRegex to not overlap with current block
        startRegex.lastIndex = endPos;
    }
    
    return markers;
}
