import { type Plugin, createFilter } from "vite";
import * as path from "path";
import glob from "glob-promise";
import type { Options } from "./utils/options";

const getUtils = async (config: Options) => {
	const docGen = await import("react-docgen-typescript");
	const { default: ts } = await import("typescript");
	const { generateDocgenCodeBlock } = await import("./utils/generate");
	const { getOptions } = await import("./utils/options");

	const { docgenOptions, compilerOptions, generateOptions } =
		getOptions(config);

	const docGenParser = docGen.withCompilerOptions(
		compilerOptions,
		docgenOptions,
	);
	const { exclude = ["**/**.stories.tsx"], include = ["**/**.tsx"] } =
		docgenOptions;
	const filter = createFilter(include, exclude);

	const files = include
		.map((filePath) =>
			glob.sync(
				path.isAbsolute(filePath)
					? filePath
					: path.join(process.cwd(), filePath),
			),
		)
		.reduce((carry, files) => carry.concat(files), []);

	const tsProgram = ts.createProgram(files, compilerOptions);

	const result = {
		docGenParser,
		filter,
		generateOptions,
		generateDocgenCodeBlock,
		tsProgram,
	};

	return result;
};

export default function reactDocgenTypescript(config: Options = {}): Plugin {
	const utilsPromise = getUtils(config);

	return {
		name: "vite:react-docgen-typescript",
		async transform(src, id) {
			try {
				const {
					filter,
					docGenParser,
					generateOptions,
					generateDocgenCodeBlock,
					tsProgram,
				} = await utilsPromise;

				if (!filter(id)) {
					return;
				}

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
	};
}
