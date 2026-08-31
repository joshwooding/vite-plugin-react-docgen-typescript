import { afterAll, describe, expect, it } from "vitest";
import createPlugin from "../index";
import type { Options } from "../utils/options";
import {
  CONTRACT_TOPOLOGIES,
  type ContractTopology,
  type ImportedTypeHmrObservation,
  runImportedTypeHmrContract,
  runOfflineUnresolvedCacheContract,
  runUnresolvedBoundaryHmrContract,
} from "./support/importedTypeHmrContract";
import {
  EXACT_LEGACY_HMR_ROW_KEYS,
  type LegacyHmrRowKey,
  legacyHmrExpectedFailures,
} from "./support/legacyHmrExpectations";

const LEGACY_MODES = [
  {
    label: "legacy default",
    mode: "default",
    options: {},
  },
  {
    label: "legacy watch",
    mode: "watch",
    options: { EXPERIMENTAL_useWatchProgram: true },
  },
  {
    label: "legacy project service",
    mode: "project-service",
    options: { EXPERIMENTAL_useProjectService: true },
  },
  {
    label: "both flags (project-service precedence)",
    mode: "both-project-service-precedence",
    options: {
      EXPERIMENTAL_useProjectService: true,
      EXPERIMENTAL_useWatchProgram: true,
    },
  },
] as const;

const createOptions = (
  topology: ContractTopology,
  modeOptions: Partial<Options>,
): Options => ({
  ...modeOptions,
  exclude: [],
  include:
    topology === "project-reference" ? ["../ui/**/*.tsx"] : ["src/**/*.tsx"],
  shouldExtractValuesFromUnion: true,
  tsconfigPath: "tsconfig.json",
});

const registrations = CONTRACT_TOPOLOGIES.flatMap((topology) =>
  LEGACY_MODES.map((mode) => ({
    label: `${topology} / ${mode.label}`,
    options: createOptions(topology, mode.options),
    pluginFactory: createPlugin,
    rowKey: `${topology}:${mode.mode}` as LegacyHmrRowKey,
    topology,
  })),
);

const observations = new Map<LegacyHmrRowKey, ImportedTypeHmrObservation>();
const stableRegistrations = CONTRACT_TOPOLOGIES.flatMap((topology) => [
  {
    label: `${topology} / stable legacy`,
    options: createOptions(topology, { docgenMode: "legacy" }),
    pluginFactory: createPlugin,
    rowKey: `${topology}:stable-legacy`,
    topology,
  },
  {
    label: `${topology} / stable project service`,
    options: createOptions(topology, { docgenMode: "project-service" }),
    pluginFactory: createPlugin,
    rowKey: `${topology}:stable-project-service`,
    topology,
  },
]);
const stableObservations = new Map<string, ImportedTypeHmrObservation>();
const warmCacheRegistration = {
  label: "same-project / warm persistent cache / stable project service",
  options: createOptions("same-project", {
    docgenMode: "project-service",
  }),
  pluginFactory: createPlugin,
  rowKey: "same-project:warm-cache-project-service",
  topology: "same-project" as const,
  warmFileSystemCache: true,
};

describe.sequential("real Vite imported-type HMR contract", () => {
  it("keeps the fixed legacy matrix and expectation ledger in sync", () => {
    const registrationKeys = registrations.map(({ rowKey }) => rowKey).sort();

    expect(registrationKeys).toEqual([...EXACT_LEGACY_HMR_ROW_KEYS]);
    expect(Object.keys(legacyHmrExpectedFailures).sort()).toEqual([
      ...EXACT_LEGACY_HMR_ROW_KEYS,
    ]);
    expect(registrations).toHaveLength(8);
  });

  it("registers both flags with project-service precedence", () => {
    const both = LEGACY_MODES.find(
      ({ mode }) => mode === "both-project-service-precedence",
    );

    expect(both?.options).toEqual({
      EXPERIMENTAL_useProjectService: true,
      EXPERIMENTAL_useWatchProgram: true,
    });
    expect(
      both?.options.EXPERIMENTAL_useProjectService
        ? "project-service"
        : both?.options.EXPERIMENTAL_useWatchProgram
          ? "watch"
          : "default",
    ).toBe("project-service");
  });

  for (const registration of registrations) {
    it(registration.rowKey, async () => {
      const observation = await runImportedTypeHmrContract(registration);
      observations.set(registration.rowKey, observation);

      if (process.env.HMR_CONTRACT_REPORT === "1") {
        console.info(
          "HMR_CONTRACT_SIGNATURE",
          observation.determinismSignature,
        );
      }

      expect(
        observation.infrastructureErrors,
        JSON.stringify(observation, null, 2),
      ).toEqual([]);
      expect(
        observation.hotErrorPayloads,
        JSON.stringify(observation, null, 2),
      ).toEqual([]);
      expect(
        observation.allHardControlsPass,
        JSON.stringify(observation, null, 2),
      ).toBe(true);
      expect(
        observation.semanticFailures,
        JSON.stringify(observation, null, 2),
      ).toEqual(legacyHmrExpectedFailures[registration.rowKey]);
    }, 60_000);
  }

  for (const registration of stableRegistrations) {
    it(registration.rowKey, async () => {
      const observation = await runImportedTypeHmrContract(registration);
      stableObservations.set(registration.rowKey, observation);
      expect(
        observation.infrastructureErrors,
        JSON.stringify(observation, null, 2),
      ).toEqual([]);
      expect(
        observation.hotErrorPayloads,
        JSON.stringify(observation, null, 2),
      ).toEqual([]);
      expect(
        observation.allHardControlsPass,
        JSON.stringify(observation, null, 2),
      ).toBe(true);
      expect(
        observation.semanticFailures,
        JSON.stringify(observation, null, 2),
      ).toEqual([]);
    }, 60_000);
  }

  it(warmCacheRegistration.rowKey, async () => {
    const observation = await runImportedTypeHmrContract(warmCacheRegistration);
    expect(
      observation.infrastructureErrors,
      JSON.stringify(observation, null, 2),
    ).toEqual([]);
    expect(
      observation.hotErrorPayloads,
      JSON.stringify(observation, null, 2),
    ).toEqual([]);
    expect(
      observation.allHardControlsPass,
      JSON.stringify(observation, null, 2),
    ).toBe(true);
    expect(
      observation.semanticFailures,
      JSON.stringify(observation, null, 2),
    ).toEqual([]);
  }, 60_000);

  it("recovers alias and extension-substitution dependency creations", async () => {
    await expect(
      runUnresolvedBoundaryHmrContract(warmCacheRegistration),
    ).resolves.toEqual({
      aliasRecovered: true,
      aliasReturned: true,
      substitutionRecovered: true,
      substitutionReturned: true,
    });
  }, 60_000);

  it("rejects a persisted unresolved result after offline dependency creation", async () => {
    const observation = await runOfflineUnresolvedCacheContract(
      warmCacheRegistration,
    );
    expect(observation.cachedFiles).toBeGreaterThan(0);
    expect(observation.recovered).toBe(true);
  }, 60_000);

  afterAll(() => {
    for (const topology of CONTRACT_TOPOLOGIES) {
      const projectService = observations.get(
        `${topology}:project-service` as LegacyHmrRowKey,
      );
      const both = observations.get(
        `${topology}:both-project-service-precedence` as LegacyHmrRowKey,
      );

      if (both && projectService) {
        expect(both.behaviorSignature).toBe(projectService.behaviorSignature);
      }
      const defaultObservation = observations.get(
        `${topology}:default` as LegacyHmrRowKey,
      );
      const stableLegacy = stableObservations.get(`${topology}:stable-legacy`);
      if (defaultObservation && stableLegacy) {
        expect(stableLegacy.behaviorSignature).toBe(
          defaultObservation.behaviorSignature,
        );
      }
      const stableProjectService = stableObservations.get(
        `${topology}:stable-project-service`,
      );
      if (projectService && stableProjectService) {
        expect(stableProjectService.behaviorSignature).toBe(
          projectService.behaviorSignature,
        );
      }
    }
  });
});
