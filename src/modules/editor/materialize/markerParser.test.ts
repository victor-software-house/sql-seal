import { parseMaterializeMarkers } from "./markerParser";

describe("Materialize Marker Parser", () => {
    it("should parse a single marker correctly", () => {
        const text = `
Hello world
<!-- sqlseal: SELECT * FROM files -->
<!-- sqlseal-updated: 2026-02-25T03:30:00Z -->
| path | name |
<!-- /sqlseal -->
Goodbye
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(markers[0].query).toBe("SELECT * FROM files");
        expect(markers[0].isExternalFile).toBe(false);
        expect(markers[0].updatedTimestamp).toBe("2026-02-25T03:30:00Z");
        expect(markers[0].existingContent.trim()).toBe("| path | name |");
    });

    it("should parse a marker without timestamp correctly", () => {
        const text = `
Hello world
<!-- sqlseal: SELECT 1 -->
some content here
<!-- /sqlseal -->
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(markers[0].query).toBe("SELECT 1");
        expect(markers[0].updatedTimestamp).toBeUndefined();
        expect(markers[0].existingContent.trim()).toBe("some content here");
    });

    it("should parse an external file marker correctly", () => {
        const text = `
<!-- sqlseal-file: queries/my_query.sql -->
<!-- /sqlseal -->
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(markers[0].query).toBe("queries/my_query.sql");
        expect(markers[0].isExternalFile).toBe(true);
    });

    it("should handle multiple markers in one file", () => {
        const text = `
First:
<!-- sqlseal: SELECT 1 -->
a
<!-- /sqlseal -->

Second:
<!-- sqlseal-file: test.sql -->
b
<!-- /sqlseal -->
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(2);
        
        expect(markers[0].query).toBe("SELECT 1");
        expect(markers[0].existingContent.trim()).toBe("a");
        
        expect(markers[1].query).toBe("test.sql");
        expect(markers[1].isExternalFile).toBe(true);
        expect(markers[1].existingContent.trim()).toBe("b");
    });
    
    it("should handle multiline queries", () => {
        const text = `
<!-- sqlseal: 
SELECT
  path
FROM files
WHERE name = 'test'
-->
content
<!-- /sqlseal -->
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(markers[0].query).toContain("SELECT");
        expect(markers[0].query).toContain("WHERE name = 'test'");
        expect(markers[0].existingContent.trim()).toBe("content");
    });

    it("should skip markers with no end sentinel", () => {
        const text = `
<!-- sqlseal: SELECT 1 -->
no end sentinel here
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(0);
    });

    it("should handle empty content between markers", () => {
        const text = `<!-- sqlseal: SELECT 1 -->
<!-- /sqlseal -->`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(markers[0].existingContent).toBe("\n");
        expect(markers[0].updatedTimestamp).toBeUndefined();
    });

    it("should expose queryEndPos correctly", () => {
        const text = `<!-- sqlseal: SELECT 1 -->
<!-- sqlseal-updated: 2026-01-01T00:00:00Z -->
| col |
<!-- /sqlseal -->`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(text.substring(0, markers[0].queryEndPos)).toBe("<!-- sqlseal: SELECT 1 -->");
        expect(markers[0].queryEndPos).toBeLessThan(markers[0].existingContentStartPos);
    });

    it("should handle mixed markers: some with timestamp, some without", () => {
        const text = `
<!-- sqlseal: SELECT 1 -->
<!-- sqlseal-updated: 2026-01-01T00:00:00Z -->
table1
<!-- /sqlseal -->

<!-- sqlseal: SELECT 2 -->
table2
<!-- /sqlseal -->
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(2);
        expect(markers[0].updatedTimestamp).toBe("2026-01-01T00:00:00Z");
        expect(markers[0].existingContent.trim()).toBe("table1");
        expect(markers[1].updatedTimestamp).toBeUndefined();
        expect(markers[1].existingContent.trim()).toBe("table2");
    });

    it("should handle inline and file markers mixed", () => {
        const text = `
<!-- sqlseal: SELECT name FROM files -->
result1
<!-- /sqlseal -->

<!-- sqlseal-file: _queries/children.sql -->
result2
<!-- /sqlseal -->
`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(2);
        expect(markers[0].isExternalFile).toBe(false);
        expect(markers[0].query).toBe("SELECT name FROM files");
        expect(markers[1].isExternalFile).toBe(true);
        expect(markers[1].query).toBe("_queries/children.sql");
    });

    it("should handle &#45;&#45; encoded double hyphens in query", () => {
        const text = `<!-- sqlseal: SELECT * FROM files WHERE name != 'test' &#45;&#45; filter -->
content
<!-- /sqlseal -->`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        expect(markers[0].query).toContain("&#45;&#45;");
        const decoded = markers[0].query.replace(/&#45;&#45;/g, '--');
        expect(decoded).toContain("-- filter");
    });

    it("should correctly compute positions for replacement", () => {
        const text = `before
<!-- sqlseal: SELECT 1 -->
old content
<!-- /sqlseal -->
after`;
        const markers = parseMaterializeMarkers(text);
        expect(markers.length).toBe(1);
        const m = markers[0];

        const queryComment = text.substring(m.startPos, m.queryEndPos);
        expect(queryComment).toBe("<!-- sqlseal: SELECT 1 -->");

        const contentRegion = text.substring(m.queryEndPos, m.existingContentEndPos);
        expect(contentRegion.trim()).toBe("old content");

        const endSentinel = text.substring(m.existingContentEndPos, m.endPos);
        expect(endSentinel).toBe("<!-- /sqlseal -->");

        const replaced = text.substring(0, m.queryEndPos) + "\nnew content\n" + text.substring(m.existingContentEndPos);
        expect(replaced).toContain("<!-- sqlseal: SELECT 1 -->");
        expect(replaced).toContain("new content");
        expect(replaced).toContain("<!-- /sqlseal -->");
        expect(replaced).not.toContain("old content");
    });
});
