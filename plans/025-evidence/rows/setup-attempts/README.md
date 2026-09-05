# Setup attempts

The first Windows Node 20 invocation failed before npm installation because Node's `--import` requires a `file://` URL for an absolute Windows path. Its original row 09 record and stdout/stderr are retained here. The evidence runner now uses `pathToFileURL`; the production verifier never changed.

Two Linux setup invocations failed before the evidence runner started:

- A shell command containing the inherited Windows PATH produced `sh: 1: Syntax error: "(" unexpected`. The final command uses `wsl -- env` with an explicit native Linux PATH and no intermediate shell.
- Verified runtimes initially extracted into `/tmp/vite-rdt-plan025` disappeared between WSL invocations. The command returned `env: ‘node’: No such file or directory`, and subsequent `ls` confirmed the directory was absent. The same verified archives were extracted into the owned persistent `/var/tmp/vite-rdt-plan025` directory, and both versions were verified before running the matrix.

These are setup failures, not package compatibility results. Runtime assertion failures remain in their matrix rows and are discussed in the integration report.
