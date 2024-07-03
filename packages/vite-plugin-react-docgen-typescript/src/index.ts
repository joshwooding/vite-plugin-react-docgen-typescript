import * as path from "path";
import { globSync } from "glob";
import { type FileParser } from "react-docgen-typescript";
import { type Plugin } from "vite";
import { defaultPropFilter } from "./utils/filter";
import type { Options } from "./utils/options";

const getDocgen = async (config: Options) => {
	const docGen = await import("react-docgen-typescript");

	const {
		tsconfigPath,
		compilerOptions,
		propFilter = defaultPropFilter,
		setDisplayName,
		typePropName,
		...rest
	} = config;

	const docgenOptions = {
		propFilter,
		...rest,
	};

	return docGen.withCompilerOptions(
		// Compiler Options are passed in to the custom program.
		{},
		docgenOptions,
	);
};

const getProgram = async (config: Options, oldProgram?: any) => {
	const { default: ts } = await import("typescript");
	const { getTSConfigFile } = await import("./utils/typescript");

	let compilerOptions = {
		jsx: ts.JsxEmit.React,
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.Latest,
	};

	if (config.compilerOptions) {
		compilerOptions = {
			...compilerOptions,
			...config.compilerOptions,
		};
	} else {
		const tsconfigPath = config.tsconfigPath ?? "./tsconfig.json";
		const { options: tsOptions } = getTSConfigFile(tsconfigPath);
		compilerOptions = { ...compilerOptions, ...tsOptions };
	}

	const files = (config.include ?? ["**/**.tsx"])
		.map((filePath) =>
			globSync(
				path.isAbsolute(filePath)
					? filePath
					: path.join(process.cwd(), filePath),
			),
		)
		.reduce((carry, files) => carry.concat(files), []);

	return ts.createProgram(files, compilerOptions, undefined, oldProgram);
};

export default function reactDocgenTypescript(config: Options = {}): Plugin {
	let tsProgram: any;
	let docGenParser: FileParser;
	let generateDocgenCodeBlock: any;
	let generateOptions: any;
	let filter: any;

	return {
		name: "vite:react-docgen-typescript",
		async configResolved() {
			const { getGenerateOptions } = await import("./utils/options");
			generateDocgenCodeBlock = (await import("./utils/generate"))
				.generateDocgenCodeBlock;
			const { createFilter } = await import("vite");

			docGenParser = await getDocgen(config);
			generateOptions = getGenerateOptions(config);
			tsProgram = await getProgram(config);
			filter = createFilter(
				config.include ?? ["**/**.tsx"],
				config.exclude ?? ["**/**.stories.tsx"],
			);
		},
		async transform(src, id) {
			if (!filter(id)) {
				return;
			}

			try {
				const componentDocs = docGenParser.parseWithProgramProvider(
					id,
					() => tsProgram,
				);

				if (!componentDocs.length) {
					return null;
				}

				return generateDocgenCodeBlock({
					filename: id,
					source: src,
					componentDocs,
					...generateOptions,
				});
			} catch (e) {
				return src;
			}
		},
		async handleHotUpdate() {
			tsProgram = await getProgram(config, tsProgram);
		},
	};
}
