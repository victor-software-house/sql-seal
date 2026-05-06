import { CheckboxParser } from "./checkbox";

function createInput() {
	return {
		checked: false,
		listeners: {} as Record<string, () => Promise<void>>,
		addEventListener(event: string, listener: () => Promise<void>) {
			this.listeners[event] = listener;
		},
	};
}

function createParser(lineContent: string) {
	const input = createInput();
	const file = { path: "Tasks.md" };
	const app = {
		vault: {
			getFileByPath: jest.fn(() => file),
			modify: jest.fn(),
			read: jest.fn(async () => lineContent),
		},
	};
	const create = jest.fn(() => input);

	return {
		app,
		input,
		parser: new CheckboxParser(app as any, create as any),
	};
}

describe("CheckboxParser", () => {
	it("renders raw task statuses when checkbox payload includes status", () => {
		const { parser } = createParser("- [/] Review upstream");

		expect(parser.renderAsString({
			checked: true,
			path: "Tasks.md",
			position: { line: 0, lineContent: "- [/] Review upstream" },
			task: "Review upstream",
			status: "/",
		})).toBe("[/]");
	});

	it("toggles a custom completed status back to an unchecked task", async () => {
		const { app, input, parser } = createParser("- [/] Review upstream");
		const result = parser.prepare({
			checked: true,
			path: "Tasks.md",
			position: { line: 0, lineContent: "- [/] Review upstream" },
			task: "Review upstream",
			status: "/",
		});

		expect("onRunCallback" in (result as any)).toBe(true);
		(result as any).onRunCallback(input);
		input.checked = false;
		await input.listeners.change();

		expect(app.vault.modify).toHaveBeenCalledWith({ path: "Tasks.md" }, "- [ ] Review upstream");
	});

	it("toggles an unchecked task to a completed task", async () => {
		const { app, input, parser } = createParser("- [ ] Plan day");
		const result = parser.prepare({
			checked: false,
			path: "Tasks.md",
			position: { line: 0, lineContent: "- [ ] Plan day" },
			task: "Plan day",
			status: " ",
		});

		expect("onRunCallback" in (result as any)).toBe(true);
		(result as any).onRunCallback(input);
		input.checked = true;
		await input.listeners.change();

		expect(app.vault.modify).toHaveBeenCalledWith({ path: "Tasks.md" }, "- [x] Plan day");
	});
});
