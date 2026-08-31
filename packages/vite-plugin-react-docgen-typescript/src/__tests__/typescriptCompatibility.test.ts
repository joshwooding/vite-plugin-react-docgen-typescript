import typescript, * as typescriptNamespace from "typescript";
import typescript6 from "typescript6";
import typescript7 from "typescript7";
import typescript43 from "typescript43";
import { describe, expect, it } from "vitest";
import {
  loadTypescript,
  normalizeTypescriptModule,
  validateTypescriptModule,
} from "../utils/typescriptCompatibility";

describe("TypeScript compatibility", () => {
  it("accepts the real TypeScript 4.3 lower-bound module", () => {
    expect(validateTypescriptModule(typescript43).version).toBe("4.3.5");
  });

  it("accepts the direct TypeScript 6 compiler module", () => {
    expect(validateTypescriptModule(typescript).version).toMatch(/^6\.0\./);
  });

  it("accepts the official TypeScript 6 compatibility wrapper", () => {
    expect(validateTypescriptModule(typescript6).version).toMatch(/^6\.0\./);
  });

  it("rejects the real TypeScript 7 module with a controlled diagnostic", () => {
    expect(() => validateTypescriptModule(typescript7)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /@joshwooding\/vite-plugin-react-docgen-typescript.*TypeScript JavaScript compiler API.*>=4\.3 <7.*TypeScript 7\.0\.2.*missing:.*#typescript-compatibility/i,
        ),
      }),
    );
  });

  it("normalizes namespace and default module wrappers", () => {
    expect(normalizeTypescriptModule(typescriptNamespace)).toBe(typescript);
    expect(normalizeTypescriptModule(typescript)).toBe(typescript);
    expect(normalizeTypescriptModule({ default: typescript })).toBe(typescript);
    expect(validateTypescriptModule({ default: typescript })).toBe(typescript);
  });

  it.each([
    ["null", null],
    ["empty object", {}],
    ["version-only object", { version: "7.0.2" }],
  ])("rejects a malformed %s without a property-access error", (_, value) => {
    expect(() => validateTypescriptModule(value)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /TypeScript JavaScript compiler API.*>=4\.3 <7.*missing:.*#typescript-compatibility/i,
        ),
      }),
    );

    expect(() => validateTypescriptModule(value)).not.toThrowError(
      /Cannot read properties of undefined/i,
    );
  });

  it("preserves the cause of a compiler load failure", async () => {
    const cause = new Error("module resolution failed");
    const load = loadTypescript(() => Promise.reject(cause));

    await expect(load).rejects.toMatchObject({
      cause,
      message: expect.stringMatching(
        /could not load the optional TypeScript peer dependency.*>=4\.3 <7.*#typescript-compatibility/i,
      ),
    });
  });
});
