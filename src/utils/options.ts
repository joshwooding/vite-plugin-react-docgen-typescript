import * as ts from "typescript";
import { GeneratorOptions } from "./generate";
import { defaultPropFilter } from "./filter";
import { getTSConfigFile } from "./typescript";
import * as docGen from "react-docgen-typescript";

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

export type DocGenOptions = docGen.ParserOptions & {
	/** Glob patterns to ignore */
	exclude?: string[];
	/** Glob patterns to include. defaults to ts|tsx */
	include?: string[];
};

export type Options = LoaderOptions & TypescriptOptions & DocGenOptions;

export function getOptions(options: Options): {
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
