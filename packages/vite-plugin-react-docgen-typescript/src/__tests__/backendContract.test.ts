import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BackendProjectState,
  type DocgenBackend,
  type DocgenBackendFactory,
  toBackendErrorRecord,
} from "../docgen/backend";
import {
  cleanBoundaryPath,
  normalizeBoundaryPath,
  normalizeBoundaryPaths,
} from "../docgen/pathIdentity";
import { isSupportedRuntimeTargetExpression } from "../docgen/runtimeTarget";

const projectState = (generation: number): BackendProjectState => ({
  configFiles: [path.resolve("tsconfig.json")],
  docgenFiles: [path.resolve("src/Component.tsx")],
  generation,
  trackedFiles: [
    path.resolve("src/Component.tsx"),
    path.resolve("src/types.ts"),
  ],
});

describe("compiler-neutral backend contract", () => {
  it("normalizes boundary paths once and deterministically", () => {
    expect(cleanBoundaryPath("src/Component.tsx?direct#fragment")).toBe(
      "src/Component.tsx",
    );
    expect(normalizeBoundaryPath("src/Component.tsx?direct")).toBe(
      path.resolve("src/Component.tsx"),
    );
    expect(
      normalizeBoundaryPaths([
        "src/types.ts#one",
        "src/Component.tsx?direct",
        "src/types.ts",
      ]),
    ).toEqual(
      [path.resolve("src/Component.tsx"), path.resolve("src/types.ts")].sort(
        (left, right) => left.localeCompare(right),
      ),
    );
  });

  it("keeps the strict compiler-neutral runtime target grammar", () => {
    expect(isSupportedRuntimeTargetExpression("Button")).toBe(true);
    expect(isSupportedRuntimeTargetExpression("Card.Header")).toBe(true);
    expect(isSupportedRuntimeTargetExpression("default")).toBe(false);
    expect(isSupportedRuntimeTargetExpression("Button[0]")).toBe(false);
  });

  it("sanitizes thrown values before they cross the backend seam", () => {
    const cause = new TypeError("broken parser");
    expect(toBackendErrorRecord(cause)).toEqual({
      message: "broken parser",
      name: "TypeError",
      stack: cause.stack,
    });
    expect(toBackendErrorRecord("plain failure")).toEqual({
      message: "plain failure",
      name: "Error",
    });
  });

  it("expresses ready, superseded, reset, and idempotent disposal outcomes", async () => {
    let disposed = false;
    let initialized = false;
    let latestRevision = 0;
    const backend: DocgenBackend = {
      async analyze({ fileName, revision }) {
        latestRevision = Math.max(latestRevision, revision);
        return {
          components: [],
          dependencies: [fileName],
          project: projectState(1),
          revision,
          status: "ok",
        };
      },
      async dispose() {
        disposed = true;
      },
      async initialize() {
        initialized = true;
        return projectState(1);
      },
      recordCacheHit() {},
      async reset({ revision }) {
        initialized = false;
        return disposed
          ? { revision, status: "disposed" }
          : { revision, status: "reset" };
      },
      async update({ change }) {
        if (disposed) {
          return {
            ready: Promise.resolve({
              revision: change.revision,
              status: "disposed",
            }),
            revision: change.revision,
            status: "pending",
          };
        }
        if (change.revision < latestRevision) {
          return {
            ready: Promise.resolve({
              revision: change.revision,
              status: "superseded",
              supersededBy: latestRevision,
            }),
            revision: change.revision,
            status: "pending",
          };
        }
        latestRevision = change.revision;
        return {
          project: projectState(change.revision),
          revision: change.revision,
          status: "ready",
        };
      },
    };
    const factory: DocgenBackendFactory = {
      async create() {
        return backend;
      },
      describe() {
        return { cacheFingerprint: "fake@1/schema-1", id: "fake" };
      },
    };

    expect(factory.describe({ rootDir: process.cwd() })).toEqual({
      cacheFingerprint: "fake@1/schema-1",
      id: "fake",
    });
    expect(await backend.initialize()).toEqual(projectState(1));
    expect(initialized).toBe(true);
    expect(
      await backend.analyze({
        fileName: path.resolve("src/Component.tsx"),
        revision: 2,
        source: "source",
      }),
    ).toEqual(
      expect.objectContaining({
        dependencies: [path.resolve("src/Component.tsx")],
        revision: 2,
        status: "ok",
      }),
    );
    const superseded = await backend.update({
      affectedComponentFiles: [],
      change: {
        fileName: path.resolve("src/types.ts"),
        kind: "change",
        revision: 1,
        source: "old",
      },
    });
    expect(superseded.status).toBe("pending");
    if (superseded.status === "pending") {
      expect(await superseded.ready).toEqual({
        revision: 1,
        status: "superseded",
        supersededBy: 2,
      });
    }
    expect(await backend.reset({ revision: 3 })).toEqual({
      revision: 3,
      status: "reset",
    });
    await backend.dispose();
    await backend.dispose();
    expect(disposed).toBe(true);
  });
});
