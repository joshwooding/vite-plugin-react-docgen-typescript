import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import reactDocgenTypescript from "../index";

const tsconfigPathForTest = path.resolve(__dirname, "tsconfig.test.json");
const fixturesPath = path.resolve(__dirname, "__fixtures__");

const fixtureTests = fs
	.readdirSync(fixturesPath)
	.map((filename) => path.join(fixturesPath, filename))
	.map((filename) => ({
		id: filename,
		code: fs.readFileSync(filename, "utf-8"),
	}));

const defaultPropValueFixture = fixtureTests.find(
	(f) => path.basename(f.id) === "DefaultPropValue.tsx",
);

describe("component fixture", () => {
	fixtureTests.forEach((fixture) => {
		it(`${path.basename(fixture.id)} has code block generated`, async () => {
			const plugin = reactDocgenTypescript({
				tsconfigPath: tsconfigPathForTest,
			});
			// @ts-ignore
			await plugin.configResolved?.();
			expect(
				// @ts-ignore
				await plugin.transform?.call({}, fixture.code, fixture.id),
			).toMatchSnapshot();
		});
	});
});

it("generates value info for enums", async () => {
	const plugin = reactDocgenTypescript({
		tsconfigPath: tsconfigPathForTest,
		shouldExtractLiteralValuesFromEnum: true,
	});
	// @ts-ignore
	await plugin.configResolved?.();
	expect(
		// @ts-ignore
		await plugin.transform?.call(
			{},
			defaultPropValueFixture?.code,
			defaultPropValueFixture?.id,
		),
	).toMatchSnapshot();
});
