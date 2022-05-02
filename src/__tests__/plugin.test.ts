import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import reactDocgenTypescript from "../plugin";

const fixturesPath = path.resolve(__dirname, "__fixtures__");

const fixtureTests = fs
  .readdirSync(fixturesPath)
  .map((filename) => path.join(fixturesPath, filename))
  .map((filename) => ({
    id: filename,
    code: fs.readFileSync(filename, "utf-8"),
  }));

const defaultPropValueFixture = fixtureTests.find(
  (f) => path.basename(f.id) === "DefaultPropValue.tsx"
)!;

describe("component fixture", () => {
  fixtureTests.forEach((fixture) => {
    it(`${path.basename(fixture.id)} has code block generated`, async () => {
      expect(
        await reactDocgenTypescript().transform?.call(
          // @ts-ignore
          {},
          fixture.code,
          fixture.id
        )
      ).toMatchSnapshot();
    });
  });
});

it("generates value info for enums", async () => {
  expect(
    await reactDocgenTypescript({
      shouldExtractLiteralValuesFromEnum: true,
    }).transform?.call(
      // @ts-ignore
      {},
      defaultPropValueFixture.code,
      defaultPropValueFixture.id
    )
  ).toMatchSnapshot();
});
