import { MarkdownRenderer } from "../MarkdownRenderer";

function createElement() {
	const children: Array<{ cls?: string; text?: string }> = [];

	return {
		children,
		empty: jest.fn(() => {
			children.length = 0;
		}),
		createDiv: jest.fn((options: { cls?: string; text?: string }) => {
			children.push(options);
			return options;
		}),
	};
}

describe("MarkdownRenderer", () => {
	it("currently renders query results as a raw markdown table text node", () => {
		const renderer = new MarkdownRenderer({} as any);
		const el = createElement();
		const render = renderer.render({}, el as any, {
			cellParser: {
				renderAsString: (data: Record<string, unknown>[]) => data,
			} as any,
			sourcePath: "DailyNotes/2026-05-06.md",
		});

		render.render({
			columns: ["title", "status"],
			data: [{ title: "EVO-6703", status: "In Progress" }],
		});

		expect(el.empty).toHaveBeenCalled();
		expect(el.createDiv).toHaveBeenCalledWith({
			cls: "sqlseal-markdown-table",
			text: [
				"| title    | status      |",
				"| -------- | ----------- |",
				"| EVO-6703 | In Progress |",
			].join("\n"),
		});
	});
});
