import type { Plugin } from "vite";
import { createLegacyBackendFactory } from "./docgen/legacyBackend";
import { createPlugin } from "./plugin";
import type { Options } from "./utils/options";

export type { DocgenMode } from "./utils/options";

export default function reactDocgenTypescript(config: Options = {}): Plugin {
  return createPlugin(config, createLegacyBackendFactory(config));
}
