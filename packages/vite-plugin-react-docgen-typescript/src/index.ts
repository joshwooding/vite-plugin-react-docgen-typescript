import fs from "node:fs/promises";
import path from "node:path";
import type { FileParser } from "react-docgen-typescript";
import type { CompilerOptions, Program } from "typescript";
import type * as tss from "typescript/lib/tsserverlibrary";
import type { Plugin } from "vite";
import { defaultPropFilter } from "./utils/filter";
import type { Options } from "./utils/options";

type Filepath = string;
type InvalidateModule = () => void;
type CloseWatch = () => void;

const getDocgen = async (config: Options) => {
  const docGen = await import("react-docgen-typescript");

  const {
    tsconfigPath,
    compilerOptions,
    propFilter = defaultPropFilter,
    setDisplayName,
    typePropName,
    EXPERIMENTAL_useWatchProgram,
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

const getCompilerOptions = async (config: Options, tsconfigPath: string) => {
  const { default: ts } = await import("typescript");
  const { getTSConfigFile } = await import("./utils/typescript");

  let compilerOptions: CompilerOptions = {
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
    const { options: tsOptions } = getTSConfigFile(tsconfigPath);
    compilerOptions = { ...compilerOptions, ...tsOptions };
  }

  return compilerOptions;
};

const createProgram = async (
  compilerOptions: CompilerOptions,
  includeArray: string[],
) => {
  const { default: ts } = await import("typescript");
  const { globSync } = await import("glob");

  const files = includeArray
    .map((filePath) =>
      globSync(
        path.isAbsolute(filePath)
          ? filePath
          : path.posix.join(process.cwd(), filePath),
      ),
    )
    .reduce((carry, files) => carry.concat(files), []);

  return ts.createProgram(files, compilerOptions);
};

const doNothing = (): void => {};
const createStubFileWatcher = (): tss.FileWatcher => ({
  close: doNothing,
});

const createProjectService = async () => {
  const { default: tsserver } = await import(
    "typescript/lib/tsserverlibrary.js"
  );

  const system: tss.server.ServerHost = {
    ...tsserver.sys,
    clearImmediate,
    clearTimeout,
    setImmediate,
    setTimeout,
    watchDirectory: createStubFileWatcher,
    watchFile: createStubFileWatcher,
  };

  return new tsserver.server.ProjectService({
    cancellationToken: { isCancellationRequested: (): boolean => false },
    host: system,
    jsDocParsingMode: 0,
    logger: {
      close: doNothing,
      endGroup: doNothing,
      getLogFileName: () => undefined,
      hasLevel: () => false,
      info: doNothing,
      loggingEnabled: () => false,
      msg: doNothing,
      perftrc: doNothing,
      startGroup: doNothing,
    },
    session: undefined,
    useInferredProjectPerProjectRoot: false,
    useSingleInferredProject: false,
  });
};

const startWatch = async (
  compilerOptions: CompilerOptions,
  tsconfigPath: string,
  onProgramCreatedOrUpdated: (program: Program) => void,
) => {
  const { default: ts } = await import("typescript");

  const host = ts.createWatchCompilerHost(
    tsconfigPath,
    compilerOptions,
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    undefined,
    () => {
      /* suppress message */
    },
  );
  host.afterProgramCreate = (program) => {
    onProgramCreatedOrUpdated(program.getProgram());
  };

  return new Promise<[Program, CloseWatch]>((resolve) => {
    const watch = ts.createWatchProgram(host);
    resolve([watch.getProgram().getProgram(), watch.close]);
  });
};

export default function reactDocgenTypescript(config: Options = {}): Plugin {
  let tsProgram: Program;
  let docGenParser: FileParser;
  // biome-ignore format: prevent trailing commas being added.
  let generateDocgenCodeBlock: typeof import(
    "./utils/generate"
  )["generateDocgenCodeBlock"];
  let generateOptions: ReturnType<
    typeof import("./utils/options")["getGenerateOptions"]
  >;
  let filter: ReturnType<typeof import("vite")["createFilter"]>;
  const moduleInvalidationQueue = new Map<Filepath, InvalidateModule>();
  let closeWatch: CloseWatch;

  let projectService: tss.server.ProjectService | null = null;

  return {
    name: "vite:react-docgen-typescript",
    async configResolved() {
      const { getGenerateOptions } = await import("./utils/options");
      generateDocgenCodeBlock = (await import("./utils/generate"))
        .generateDocgenCodeBlock;
      const { createFilter } = await import("vite");

      docGenParser = await getDocgen(config);
      generateOptions = getGenerateOptions(config);
      const tsconfigPath = config.tsconfigPath ?? "./tsconfig.json";
      const compilerOptions = await getCompilerOptions(config, tsconfigPath);

      const includeArray = config.include ?? ["**/**.tsx"];

      filter = createFilter(
        includeArray,
        config.exclude ?? ["**/**.stories.tsx"],
      );

      if (config.EXPERIMENTAL_useProjectService) {
        projectService = await createProjectService();
        return;
      }

      if (config.EXPERIMENTAL_useWatchProgram) {
        [tsProgram, closeWatch] = await startWatch(
          compilerOptions,
          tsconfigPath,
          (program) => {
            tsProgram = program;

            for (const [
              filepath,
              invalidateModule,
            ] of moduleInvalidationQueue.entries()) {
              invalidateModule();
              moduleInvalidationQueue.delete(filepath);
            }
          },
        );
      } else {
        tsProgram = await createProgram(compilerOptions, includeArray);
      }
    },
    async transform(src, id) {
      if (!filter(id)) {
        return;
      }
      const source = await fs.readFile(id, "utf-8");
      try {
        const componentDocs = docGenParser.parseWithProgramProvider(id, () => {
          if (tsProgram) {
            return tsProgram;
          }

          projectService?.openClientFile(
            id,
            source,
            /* scriptKind */ undefined,
            projectService?.currentDirectory,
          );

          const scriptInfo = projectService?.getScriptInfo(id);

          if (scriptInfo?.fileName) {
            const languageServiceProgram = projectService
              ?.getDefaultProjectForFile(scriptInfo?.fileName, true)
              ?.getLanguageService(true)
              .getProgram();

            if (languageServiceProgram) {
              return languageServiceProgram;
            }
          }

          throw new Error("Internal Error: No program available");
        });

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
    async handleHotUpdate({ file, server, modules }) {
      if (!config.EXPERIMENTAL_useWatchProgram) return;
      if (!filter(file)) return;

      const module = modules.find((mod) => mod.file === file);
      if (!module) return;

      moduleInvalidationQueue.set(file, () => {
        server.moduleGraph.invalidateModule(
          module,
          undefined,
          Date.now(),
          true,
        );
      });
    },
    closeBundle() {
      if (!config.EXPERIMENTAL_useWatchProgram) return;
      closeWatch();
    },
    buildEnd() {
      if (!config.EXPERIMENTAL_useWatchProgram) return;
      closeWatch();
    },
  };
}
