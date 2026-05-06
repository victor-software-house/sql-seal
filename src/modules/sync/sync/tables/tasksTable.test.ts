import { TasksFileSyncTable } from "./tasksTable";

const taskNote = {
	path: "Projects/Today.md",
	content: [
		"# Today",
		"",
		"- [ ] Plan day",
		"- [x] Ship fix",
		"- [/] Review upstream",
		"- [-] Cancel stale task",
		"- Plain list item",
	].join("\n"),
	listItems: [
		{ task: " ", position: { start: { line: 2 } } },
		{ task: "x", position: { start: { line: 3 } } },
		{ task: "/", position: { start: { line: 4 } } },
		{ task: "-", position: { start: { line: 5 } } },
		{ position: { start: { line: 6 } } },
	],
	headings: [
		{ heading: "Today", level: 1, position: { start: { line: 0 } } },
	],
};

function createTasksTable() {
	const file = { path: taskNote.path };
	const db = {
		createIndex: jest.fn(),
		createTableNoTypes: jest.fn(),
		deleteData: jest.fn(),
		insertData: jest.fn(),
	};
	const app = {
		metadataCache: {
			getFileCache: jest.fn(() => ({
				headings: taskNote.headings,
				listItems: taskNote.listItems,
			})),
		},
		vault: {
			read: jest.fn(async () => taskNote.content),
		},
	};

	return {
		app,
		db,
		file,
		table: new TasksFileSyncTable(db as any, app as any),
	};
}

describe("TasksFileSyncTable", () => {
	beforeAll(() => {
		(Array.prototype as any).last ??= function last() {
			return this[this.length - 1];
		};
	});

	it("includes the raw checkbox status for every task row", async () => {
		const { file, table } = createTasksTable();

		const rows = await table.getFileTasks(file as any);

		expect(rows).toHaveLength(4);
		expect(rows.map(row => row.status)).toEqual([" ", "x", "/", "-"]);
		expect(rows.map(row => row.task)).toEqual([
			"Plan day",
			"Ship fix",
			"Review upstream",
			"Cancel stale task",
		]);
	});

	it("preserves the existing completed semantics and heading fields", async () => {
		const { file, table } = createTasksTable();

		const rows = await table.getFileTasks(file as any);

		expect(rows.map(row => row.completed)).toEqual([0, 1, 1, 1]);
		expect(rows.map(row => row.heading)).toEqual(["Today", "Today", "Today", "Today"]);
		expect(rows.map(row => row.heading_level)).toEqual([1, 1, 1, 1]);
	});

	it("stores status inside checkbox custom cell payload", async () => {
		const { file, table } = createTasksTable();

		const rows = await table.getFileTasks(file as any);
		const payloads = rows.map(row => JSON.parse(
			row.checkbox.replace(/^SQLSEALCUSTOM\(/, "").replace(/\)$/, ""),
		));

		expect(payloads.map(payload => payload.values.status)).toEqual([" ", "x", "/", "-"]);
	});

	it("creates the tasks table with a status column", async () => {
		const { db, table } = createTasksTable();

		await table.onInit();

		expect(db.createTableNoTypes).toHaveBeenCalledWith("tasks", [
			"checkbox",
			"task",
			"completed",
			"status",
			"filePath",
			"path",
			"position",
			"heading",
			"heading_level",
		]);
	});
});
