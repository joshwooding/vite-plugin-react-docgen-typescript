import { type Plugin, createFilter } from "vite";
import type { Options } from "./utils/options";
import type { CompilerOptions } from "typescript";

const getProgram = async (
  sourcePath: string,
  compilerOptions: CompilerOptions
) => {
  const { default: ts } = await import("typescript");

  return ts.createProgram([sourcePath], compilerOptions);
};

const getUtils = async (config: Options) => {
  const docGen = await import("react-docgen-typescript");
  const { generateDocgenCodeBlock } = await import("./utils/generate");
  const { getOptions } = await import("./utils/options");

  const { docgenOptions, compilerOptions, generateOptions } =
    getOptions(config);

  const docGenParser = docGen.withCompilerOptions(
    compilerOptions,
    docgenOptions
  );
  const { exclude = ["**/**.stories.tsx"], include = ["**/**.tsx"] } =
    docgenOptions;
  const filter = createFilter(include, exclude);

  const result = {
    docGenParser,
    filter,
    generateOptions,
    compilerOptions,
    generateDocgenCodeBlock,
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
          compilerOptions,
          generateDocgenCodeBlock,
        } = await utilsPromise;

        const tsProgram = await getProgram(id, compilerOptions);

        if (!filter(id)) {
          return;
        }

        const componentDocs = docGenParser.parseWithProgramProvider(
          id,
          () => tsProgram
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
