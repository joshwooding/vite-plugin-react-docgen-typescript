import { type Plugin, createFilter } from "vite";
import * as docGen from "react-docgen-typescript";
import * as ts from "typescript";
import glob from "glob-promise";
import * as path from "path";
import {
	generateDocgenCodeBlock,
	GeneratorOptions,
} from "./generateDocgenCodeBlock";
import type { PropFilter } from "react-docgen-typescript/lib/parser";

/** Get the contents of the tsconfig in the system */
function getTSConfigFile(tsconfigPath: string): Partial<ts.ParsedCommandLine> {
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

const defaultPropFilter: PropFilter = (prop) => {
	return !prop.parent?.fileName.includes("node_modules");
};

interface LoaderOptions {
	/**
	 * Automatically set the component's display name. If you want to set display
	 * names yourself or are using another plugin to do this, you should disable
	 * this option.
	 *
	 * ```
	 * class MyComponent extends React.Component {
	 * ...
	 * }
	 *
	 * MyComponent.displayName = "MyComponent";
	 * ```
	 *
	 * @default true
	 */
	setDisplayName?: boolean;

	/**
	 * Specify the name of the property for docgen info prop type.
	 *
	 * @default "type"
	 */
	typePropName?: string;
}

interface TypescriptOptions {
	/**
	 * Specify the location of the tsconfig.json to use. Can not be used with
	 * compilerOptions.
	 **/
	tsconfigPath?: string;
	/** Specify TypeScript compiler options. Can not be used with tsconfigPath. */
	compilerOptions?: ts.CompilerOptions;
}

type DocGenOptions = docGen.ParserOptions & {
	/** Glob patterns to ignore */
	exclude?: string[];
	/** Glob patterns to include. defaults to ts|tsx */
	include?: string[];
};

export type Options = LoaderOptions & TypescriptOptions & DocGenOptions;

function getOptions(options: Options): {
	docgenOptions: DocGenOptions;
	generateOptions: Pick<GeneratorOptions, "setDisplayName" | "typePropName">;
	compilerOptions: ts.CompilerOptions;
} {
	const {
		tsconfigPath = "./tsconfig.json",
		compilerOptions: userCompilerOptions,
		setDisplayName = true,
		typePropName = "type",
		propFilter = defaultPropFilter,
		...docgenOptions
	} = options;

	let compilerOptions = {
		jsx: ts.JsxEmit.React,
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.Latest,
	};

	if (userCompilerOptions) {
		compilerOptions = {
			...compilerOptions,
			...userCompilerOptions,
		};
	} else {
		const { options: tsOptions } = getTSConfigFile(tsconfigPath);
		compilerOptions = { ...compilerOptions, ...tsOptions };
	}

	return {
		docgenOptions: {
			propFilter,
			...docgenOptions,
		},
		generateOptions: {
			setDisplayName,
			typePropName,
		},
		compilerOptions,
	};
}

export default function reactDocgenTypescript(config: Options = {}): Plugin {
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

	return {
		name: "vite:react-docgen-typescript",
		async transform(src, id) {
			if (!filter(id)) return;
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
		},
	};
}
