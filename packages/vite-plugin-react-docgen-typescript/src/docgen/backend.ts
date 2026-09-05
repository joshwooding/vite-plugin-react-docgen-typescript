import type { DocgenComponent } from "./types";

export interface BackendDescriptor {
  readonly cacheFingerprint: string;
  readonly id: string;
}

export interface BackendProjectState {
  readonly configFiles: readonly string[];
  readonly docgenFiles: readonly string[];
  readonly generation: number;
  readonly trackedFiles: readonly string[];
}

export interface BackendErrorRecord {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

export interface BackendFileSelection {
  readonly exclude: readonly string[];
  readonly hasIncludes: boolean;
  readonly include: readonly string[];
  matchesDocgenFile(fileName: string): boolean;
}

interface AnalyzeResultBase {
  readonly dependencies: readonly string[];
  readonly project: BackendProjectState;
  readonly revision: number;
  readonly unresolvedDependencies?: readonly string[];
}

export type AnalyzeResult =
  | (AnalyzeResultBase & {
      readonly components: readonly DocgenComponent[];
      readonly status: "ok";
    })
  | (AnalyzeResultBase & {
      readonly error: BackendErrorRecord;
      readonly status: "error";
    });

export type UpdateCompletion =
  | {
      readonly project: BackendProjectState;
      readonly revision: number;
      readonly status: "ready";
    }
  | {
      readonly revision: number;
      readonly status: "superseded";
      readonly supersededBy: number;
    }
  | { readonly revision: number; readonly status: "disposed" };

export type ResetCompletion =
  | { readonly revision: number; readonly status: "reset" }
  | {
      readonly revision: number;
      readonly status: "superseded";
      readonly supersededBy: number;
    }
  | { readonly revision: number; readonly status: "disposed" };

export type FileUpdateResult =
  | { readonly revision: number; readonly status: "ignored" }
  | { readonly revision: number; readonly status: "project-reset" }
  | {
      readonly project: BackendProjectState;
      readonly revision: number;
      readonly status: "ready";
    }
  | {
      readonly ready: Promise<UpdateCompletion>;
      readonly revision: number;
      readonly status: "pending";
    };

export type BackendSourceChange =
  | {
      readonly fileName: string;
      readonly kind: "change" | "create";
      readonly revision: number;
      readonly source: string;
    }
  | {
      readonly fileName: string;
      readonly kind: "delete";
      readonly revision: number;
    };

export interface DocgenBackend {
  analyze(input: {
    fileName: string;
    revision: number;
    source: string;
  }): Promise<AnalyzeResult>;
  dispose(): Promise<void>;
  initialize(): Promise<BackendProjectState>;
  /** Return complete membership from the target program without extracting docgen. */
  prepareCacheValidation?(input: {
    fileName: string;
    revision: number;
    source: string;
  }): Promise<
    | { dependencies: readonly string[]; project: BackendProjectState }
    | undefined
  >;
  recordCacheHit(input: {
    cache: "memory" | "persistent";
    fileName: string;
  }): void;
  reset(input: { revision: number }): Promise<ResetCompletion>;
  update(input: {
    affectedComponentFiles: readonly string[];
    change: BackendSourceChange;
  }): Promise<FileUpdateResult>;
}

export interface DocgenBackendFactory {
  create(context: {
    rootDir: string;
    selection: BackendFileSelection;
  }): Promise<DocgenBackend>;
  describe(context: { rootDir: string }): BackendDescriptor;
}

export const toBackendErrorRecord = (error: unknown): BackendErrorRecord => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  return { message: String(error), name: "Error" };
};
