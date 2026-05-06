#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_NAME = "sqlseal";
const CHANGESET_DIR = ".changeset";
const OVERRIDE_FILE = join(CHANGESET_DIR, "allow-consecutive-nonpatch.json");
const BUMP_ORDER = { none: 0, patch: 1, minor: 2, major: 3 };

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) throw new Error(`Invalid semver version: ${version}`);
	return match.slice(1).map(Number);
}

function compareVersions(a, b) {
	const av = parseVersion(a);
	const bv = parseVersion(b);
	for (let i = 0; i < av.length; i += 1) {
		if (av[i] !== bv[i]) return av[i] - bv[i];
	}
	return 0;
}

function bumpType(from, to) {
	const [fromMajor, fromMinor, fromPatch] = parseVersion(from);
	const [toMajor, toMinor, toPatch] = parseVersion(to);
	if (toMajor > fromMajor) return "major";
	if (toMajor === fromMajor && toMinor > fromMinor) return "minor";
	if (toMajor === fromMajor && toMinor === fromMinor && toPatch > fromPatch) return "patch";
	if (toMajor === fromMajor && toMinor === fromMinor && toPatch === fromPatch) return "none";
	throw new Error(`Version moved backwards: ${from} -> ${to}`);
}

function semverTags() {
	return git(["tag", "--list"])
		.split("\n")
		.map((tag) => tag.trim())
		.filter((tag) => /^\d+\.\d+\.\d+$/.test(tag))
		.sort(compareVersions);
}

function pendingChangesetBump() {
	if (!existsSync(CHANGESET_DIR)) return "none";
	let bump = "none";
	for (const file of readdirSync(CHANGESET_DIR)) {
		if (!file.endsWith(".md") || file === "README.md") continue;
		const content = readFileSync(join(CHANGESET_DIR, file), "utf8");
		const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
		const line = frontmatter
			.split("\n")
			.map((item) => item.trim())
			.find((item) => item.startsWith(`"${PACKAGE_NAME}":`) || item.startsWith(`${PACKAGE_NAME}:`));
		if (!line) continue;
		const value = line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
		if (!(value in BUMP_ORDER)) {
			throw new Error(`Invalid changeset bump '${value}' in ${join(CHANGESET_DIR, file)}`);
		}
		if (BUMP_ORDER[value] > BUMP_ORDER[bump]) bump = value;
	}
	return bump;
}

function readOverride(expected) {
	if (!existsSync(OVERRIDE_FILE)) return null;
	const parsed = JSON.parse(readFileSync(OVERRIDE_FILE, "utf8"));
	const required = {
		package: PACKAGE_NAME,
		currentVersion: expected.currentVersion,
		latestReleaseVersion: expected.latestReleaseVersion,
		previousReleaseVersion: expected.previousReleaseVersion,
		previousReleaseType: expected.previousReleaseType,
		proposedReleaseType: expected.proposedReleaseType,
	};
	for (const [key, value] of Object.entries(required)) {
		if (parsed[key] !== value) {
			throw new Error(
				`${OVERRIDE_FILE} has ${key}=${JSON.stringify(parsed[key])}; expected ${JSON.stringify(value)}`,
			);
		}
	}
	if (typeof parsed.approvedBy !== "string" || parsed.approvedBy.trim().length === 0) {
		throw new Error(`${OVERRIDE_FILE} must include non-empty approvedBy`);
	}
	if (typeof parsed.reason !== "string" || parsed.reason.trim().length < 20) {
		throw new Error(`${OVERRIDE_FILE} must include a concrete reason of at least 20 characters`);
	}
	return parsed;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const currentVersion = packageJson.version;
const tags = semverTags();

if (tags.length < 2) {
	console.log("Release bump guard: fewer than two semver tags exist; nothing to compare.");
	process.exit(0);
}

const latestReleaseVersion = tags.at(-1);
const previousReleaseVersion = tags.at(-2);
const previousReleaseType = bumpType(previousReleaseVersion, latestReleaseVersion);
const versionBump = bumpType(latestReleaseVersion, currentVersion);
const changesetBump = pendingChangesetBump();
const proposedReleaseType =
	BUMP_ORDER[versionBump] > BUMP_ORDER[changesetBump] ? versionBump : changesetBump;

console.log(
	[
		`Release bump guard: current=${currentVersion}`,
		`latest=${latestReleaseVersion}`,
		`previous=${previousReleaseVersion}`,
		`previousType=${previousReleaseType}`,
		`versionBump=${versionBump}`,
		`changesetBump=${changesetBump}`,
		`proposed=${proposedReleaseType}`,
	].join(" "),
);

if (proposedReleaseType !== "minor" && proposedReleaseType !== "major") {
	process.exit(0);
}

if (previousReleaseType !== proposedReleaseType) {
	process.exit(0);
}

const expected = {
	currentVersion,
	latestReleaseVersion,
	previousReleaseVersion,
	previousReleaseType,
	proposedReleaseType,
};
const override = readOverride(expected);
if (override) {
	console.log(
		`Release bump guard: allowing consecutive ${proposedReleaseType} release with override approved by ${override.approvedBy}.`,
	);
	process.exit(0);
}

console.error(
	[
		`Consecutive ${proposedReleaseType} releases are blocked.`,
		`Previous release ${previousReleaseVersion} -> ${latestReleaseVersion} was ${previousReleaseType}.`,
		`This change proposes another ${proposedReleaseType}.`,
		`To override with explicit human consent, add ${OVERRIDE_FILE} with:`,
		JSON.stringify(
			{
				...expected,
				package: PACKAGE_NAME,
				approvedBy: "human name or handle",
				reason: "Why this consecutive non-patch release is intentional.",
			},
			null,
			2,
		),
	].join("\n"),
);
process.exit(1);
