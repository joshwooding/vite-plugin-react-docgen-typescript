import type { Plugin } from "vite";

export const runTransformHook = (
  plugin: Plugin,
  context: unknown,
  source: string,
  id: string,
) => {
  const hook = plugin.transform;
  if (!hook) return;

  const handler = typeof hook === "function" ? hook : hook.handler;
  return handler.call(context as never, source, id);
};
