import { MarkdownRenderer } from "../MarkdownRenderer";
import { MarkdownRenderer as ObsidianMarkdownRenderer } from "obsidian";

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
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("renders fallback markdown tables through Obsidian's markdown engine", async () => {
		const renderMarkdown = jest.spyOn(ObsidianMarkdownRenderer, "render")
			.mockImplementation(async (_app, markdown, el) => {
				(el as any).innerHTML = `<rendered>${markdown}</rendered>`;
			});
		const renderer = new MarkdownRenderer({} as any);
		const el = createElement();
		const render = renderer.render(renderer.validateConfig(""), el as any, {
			cellParser: {
				renderAsString: (data: Record<string, unknown>[]) => data,
			} as any,
			sourcePath: "DailyNotes/2026-05-06.md",
			component: {} as any,
		});

		await render.render({
			columns: ["title", "status"],
			data: [{ title: "EVO-6703", status: "In Progress" }],
		});

		expect(el.empty).toHaveBeenCalled();
		expect(el.createDiv).not.toHaveBeenCalled();
		expect(renderMarkdown).toHaveBeenCalledWith(
			{},
			[
				"| title    | status      |",
				"| -------- | ----------- |",
				"| EVO-6703 | In Progress |",
			].join("\n"),
			el,
			"DailyNotes/2026-05-06.md",
			{},
		);
	});

	it("renders MARKDOWN template output through Obsidian", async () => {
		const renderMarkdown = jest.spyOn(ObsidianMarkdownRenderer, "render")
			.mockImplementation(async () => undefined);
		const renderer = new MarkdownRenderer({} as any);
		const config = renderer.validateConfig([
			"missing='—'",
			"## {{ properties.title }}",
			"{% for row in data %}",
			"- {{ row.note }} — {{ row.status }}",
			"{% endfor %}",
		].join("\n"));
		const render = renderer.render(config, createElement() as any, {
			cellParser: {
				renderAsString: (data: Record<string, unknown>[]) => data,
			} as any,
			sourcePath: "DailyNotes/2026-05-06.md",
			component: {} as any,
		});

		await render.render({
			columns: ["note", "status"],
			data: [{ note: "EVO-6703", status: null }],
			frontmatter: { title: "Today" },
		});

		expect(renderMarkdown).toHaveBeenCalledWith(
			{},
			[
				"## Today",
				"",
				"- EVO-6703 — —",
				"",
			].join("\n"),
			expect.anything(),
			"DailyNotes/2026-05-06.md",
			{},
		);
	});

	it("rejects nested sqlseal fences in templates", () => {
		const renderer = new MarkdownRenderer({} as any);

		expect(() => renderer.validateConfig([
			"```sqlseal",
			"SELECT * FROM files",
			"```",
		].join("\n"))).toThrow("MARKDOWN renderer output cannot contain nested sqlseal fenced codeblocks");
	});
});
