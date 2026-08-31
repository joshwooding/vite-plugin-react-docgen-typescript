import { dirname } from "node:path";
import type ts from "typescript";

/** Get the parsed contents of a tsconfig file. */

function formatDiagnostic(
  typescriptModule: typeof import("typescript"),
  diagnostic: ts.Diagnostic,
): string {
  if (typeof diagnostic.messageText === "string") {
    return diagnostic.messageText;
  }

  return typescriptModule.flattenDiagnosticMessageText(
    diagnostic.messageText,
    "\n",
  );
}

export function getTSConfigFile(
  typescriptModule: typeof import("typescript"),
  tsconfigPath: string,
): ts.ParsedCommandLine {
  const basePath = dirname(tsconfigPath);
  const configFile = typescriptModule.readConfigFile(
    tsconfigPath,
    typescriptModule.sys.readFile,
  );

  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig at "${tsconfigPath}": ${formatDiagnostic(typescriptModule, configFile.error)}`,
    );
  }

  const parsedConfig = typescriptModule.parseJsonConfigFileContent(
    configFile.config,
    typescriptModule.sys,
    basePath,
    {},
    tsconfigPath,
  );

  if (parsedConfig.errors.length > 0) {
    const errorText = parsedConfig.errors
      .map((diagnostic) => formatDiagnostic(typescriptModule, diagnostic))
      .join("\n");

    throw new Error(
      `Failed to parse tsconfig at "${tsconfigPath}": ${errorText}`,
    );
  }

  return parsedConfig;
}
