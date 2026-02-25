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
});
