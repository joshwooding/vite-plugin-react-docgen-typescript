import * as path from "path";
import * as ts from "typescript";

/** Get the contents of the tsconfig in the system */

export function getTSConfigFile(
	tsconfigPath: string,
): Partial<ts.ParsedCommandLine> {
	try {
		const basePath = path.dirname(tsconfigPath);
		const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

		return ts.parseJsonConfigFileContent(
			configFile.config,
			ts.sys,
			basePath,
			{},
			tsconfigPath,
		);
	} catch (error) {
		return {};
	}
}
