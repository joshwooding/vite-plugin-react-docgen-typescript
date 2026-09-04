import type { Plugin } from "vite";
import { createLegacyBackendFactory } from "./docgen/legacyBackend";
import { createNativeBackendFactory } from "./docgen/nativeBackend";
import { createPlugin } from "./plugin";
import {
  type Options,
  type PublicOptions,
  resolveDocgenRuntimeMode,
} from "./utils/options";

export type { DocgenMode } from "./utils/options";

export default function reactDocgenTypescript(
  publicConfig: PublicOptions = {},
): Plugin {
  const config = publicConfig as Options;
  const backendFactory =
    resolveDocgenRuntimeMode(config) === "native"
      ? createNativeBackendFactory(config)
      : createLegacyBackendFactory(config);

  return createPlugin(config, backendFactory);
}
