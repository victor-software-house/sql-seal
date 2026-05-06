export class App {}
export class Plugin {}
export class Component {
	load() {}
	unload() {}
}
export class MarkdownRenderer {
	static render = jest.fn(async (_app, markdown: string, el: any) => {
		el.innerHTML = markdown;
	});
}
export class TAbstractFile {
	path = "";
}
export class TFile extends TAbstractFile {
	extension = "";
}
