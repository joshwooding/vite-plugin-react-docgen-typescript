import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import reactDocgenTypescript from "../index";

const tsconfigPathForTest = resolve(__dirname, "tsconfig.test.json");
const fixturesPath = resolve(__dirname, "__fixtures__");

const fixtureTests = readdirSync(fixturesPath)
  .map((filename) => join(fixturesPath, filename))
  .map((filename) => ({
    id: filename,
    code: readFileSync(filename, "utf-8"),
  }));

const defaultPropValueFixture = fixtureTests.find(
  (f) => basename(f.id) === "DefaultPropValue.tsx",
);

describe("component fixture", () => {
  fixtureTests.forEach((fixture) => {
    it(`${basename(fixture.id)} has code block generated`, async () => {
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

describe("EXPERIMENTAL_useWatchProgram", () => {
  describe("component fixture", () => {
    fixtureTests.forEach((fixture) => {
      it(`${basename(fixture.id)} has code block generated`, async () => {
        const plugin = reactDocgenTypescript({
          EXPERIMENTAL_useWatchProgram: true,
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
      EXPERIMENTAL_useWatchProgram: true,
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
});

describe("EXPERIMENTAL_useProjectService", () => {
  describe("component fixture", () => {
    fixtureTests.forEach((fixture) => {
      it(`${basename(fixture.id)} has code block generated`, async () => {
        const plugin = reactDocgenTypescript({
          EXPERIMENTAL_useProjectService: true,
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
      EXPERIMENTAL_useProjectService: true,
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
});
