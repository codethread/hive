const root = `${import.meta.dir}/../../../`;
const packageRoot = `${root}lib/hive-ui/`;
const design = await Bun.file(`${root}docs/design/hive-ui.md`).text();
const glossary = await Bun.file(`${packageRoot}GLOSSARY.md`).text();
const documented = new Map<string, string[]>();
const definitions = new Set(
	[...glossary.matchAll(/^\*\*(?<term>[^*]+)\*\*:/gmu)].map((match) => match.groups!["term"]!),
);

for (const match of design.matchAll(
	/^\| (?<term>[^|]+) \| `(?<title>[^`]+)` \| (?<components>[^|]+) \|$/gmu,
)) {
	const { term, title, components } = match.groups!;
	if (!definitions.has(term!) || title!.slice(title!.indexOf("/") + 1) !== term) {
		throw new Error(`Story catalogue name “${title}” must use a canonical UI glossary term.`);
	}
	if (documented.has(title!)) {
		throw new Error(`Duplicate story catalogue title: ${title}`);
	}
	documented.set(
		title!,
		[...components!.matchAll(/`(?<component>[^`]+)`/gu)].map(
			(entry) => entry.groups!["component"]!,
		),
	);
}

const actual = new Set<string>();
for await (const path of new Bun.Glob("src/stories/*.stories.tsx").scan(packageRoot)) {
	const source = await Bun.file(`${packageRoot}${path}`).text();
	const title = /\btitle: "(?<title>[^"]+)"/u.exec(source)?.groups?.["title"];
	if (title === undefined || actual.has(title)) {
		throw new Error(`Story metadata needs a unique literal title: ${path}`);
	}
	actual.add(title);
	if (!documented.has(title)) {
		throw new Error(`Story “${title}” is missing from the design component catalogue.`);
	}
}

const exports = new Set<string>();
for await (const path of new Bun.Glob("src/*.tsx").scan(packageRoot)) {
	const source = await Bun.file(`${packageRoot}${path}`).text();
	for (const match of source.matchAll(/export function (?<component>\w+)/gu)) {
		exports.add(match.groups!["component"]!);
	}
}
for (const [title, components] of documented) {
	if (!actual.has(title)) {
		throw new Error(`Design catalogue story “${title}” has no story file.`);
	}
	for (const component of components) {
		if (!exports.has(component)) {
			throw new Error(`Design catalogue component “${component}” is not exported by Hive UI.`);
		}
	}
}
console.log(`Verified ${actual.size} story groups against the UI glossary and design catalogue.`);
