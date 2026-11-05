// biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub Actions expressions are literal fixture data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type JsonObject = Record<string, unknown>;
type WorkflowStep = JsonObject & {
  env?: JsonObject;
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: JsonObject;
};

const workflowPath = fileURLToPath(
  new URL("../../.github/workflows/snapshot.yml", import.meta.url),
);
const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = parse(workflowSource) as JsonObject & { jobs: JsonObject };
const changesetConfig = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../.changeset/config.json", import.meta.url)),
    "utf8",
  ),
) as JsonObject;

const job = (name: string) => workflow.jobs[name] as JsonObject;
const steps = (name: string) => job(name).steps as WorkflowStep[];
const stepNamed = (jobName: string, name: string) => {
  const result = steps(jobName).find((step) => step.name === name);
  expect(result, `${jobName} is missing step ${name}`).toBeDefined();
  return result as WorkflowStep;
};

const visit = (value: unknown, callback: (value: unknown) => void): void => {
  callback(value);
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, callback);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      callback(key);
      visit(entry, callback);
    }
  }
};

const stringsIn = (value: unknown) => {
  const strings: string[] = [];
  visit(value, (entry) => {
    if (typeof entry === "string") strings.push(entry);
  });
  return strings;
};

const actionPins = new Map([
  ["actions/github-script", "ed597411d8f924073f98dfc5c65a23a2325f34cd"],
  ["actions/checkout", "9f698171ed81b15d1823a05fc7211befd50c8ae0"],
  ["actions/setup-node", "249970729cb0ef3589644e2896645e5dc5ba9c38"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
]);

describe("snapshot workflow security boundary", () => {
  it("uses exactly three separately authorized jobs", () => {
    expect(Object.keys(workflow.jobs)).toStrictEqual([
      "authorize",
      "build",
      "publish",
    ]);
    expect(job("authorize")["runs-on"]).toBe("ubuntu-latest");
    expect(job("build")["runs-on"]).toBe("ubuntu-latest");
    expect(job("publish")["runs-on"]).toBe("ubuntu-latest");
    expect(job("build").needs).toBe("authorize");
    expect(job("publish").needs).toStrictEqual(["authorize", "build"]);
    expect(workflow.concurrency).toMatchObject({
      group: "snapshot-${{ github.event.issue.number }}",
      "cancel-in-progress": false,
    });
  });

  it("authorizes an immutable same-repository open pull request", () => {
    const authorize = stepNamed("authorize", "Authorize snapshot request");
    const script = String(authorize.with?.script);
    expect(authorize.uses).toContain("actions/github-script@");
    expect(script).toContain(
      "github.rest.repos.getCollaboratorPermissionLevel",
    );
    expect(script).toContain("github.rest.pulls.get");
    expect(script).toContain('pull.data.state !== "open"');
    expect(script).toContain("pull.data.head.repo?.full_name");
    expect(script).toContain("`${context.repo.owner}/${context.repo.repo}`");
    expect(script).toContain("/^[0-9a-f]{40}$/");
    expect(script).toContain('core.setOutput("head_sha", headSha)');
    expect(script).toContain('content: "eyes"');
    expect(job("authorize").outputs).toStrictEqual({
      head_sha: "${{ steps.authorize.outputs.head_sha }}",
      pr_number: "${{ steps.authorize.outputs.pr_number }}",
    });
  });

  it("build job checks out and verifies only the authorized SHA", () => {
    const checkout = stepNamed("build", "Checkout authorized pull request");
    expect(checkout.with).toMatchObject({
      ref: "${{ needs.authorize.outputs.head_sha }}",
      "fetch-depth": 1,
      "persist-credentials": false,
    });
    const checkoutIndex = steps("build").indexOf(checkout);
    const verify = steps("build")[checkoutIndex + 1];
    expect(verify.name).toBe("Verify authorized commit");
    expect(verify.env).toStrictEqual({
      AUTHORIZED_SHA: "${{ needs.authorize.outputs.head_sha }}",
    });
    expect(verify.run).toContain(
      'test "$(git rev-parse HEAD)" = "$AUTHORIZED_SHA"',
    );
    expect(stringsIn(job("build")).join("\n")).not.toMatch(
      /secrets\.|id-token|NPM_TOKEN|NODE_AUTH_TOKEN/,
    );
  });

  it("publish job never checks out pull-request or repository code", () => {
    const checkouts = steps("publish").filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkouts).toHaveLength(0);
    expect(stringsIn(job("publish")).join("\n")).not.toContain(
      "github.workflow_sha",
    );
  });

  it("uses empty top-level permissions and exact per-job allowlists", () => {
    expect(workflow.permissions).toStrictEqual({});
    expect(job("authorize").permissions).toStrictEqual({
      issues: "write",
      "pull-requests": "read",
    });
    expect(job("build").permissions).toStrictEqual({ contents: "read" });
    expect(job("publish").permissions).toStrictEqual({
      issues: "write",
      "pull-requests": "read",
    });
    expect(JSON.stringify(job("publish"))).not.toContain("id-token");
  });

  it("uploads, downloads, and inspects exactly the fixed snapshot tarball", () => {
    const upload = stepNamed("build", "Upload snapshot artifact");
    expect(upload.with).toStrictEqual({
      name: "snapshot-package-${{ needs.authorize.outputs.head_sha }}",
      path: "${{ runner.temp }}/snapshot/package.tgz",
      "if-no-files-found": "error",
      "retention-days": 1,
      "compression-level": 0,
    });
    const download = stepNamed("publish", "Download snapshot artifact");
    expect(download.with).toStrictEqual({
      name: "snapshot-package-${{ needs.authorize.outputs.head_sha }}",
      path: "${{ runner.temp }}/snapshot-artifact",
    });
    const validate = stepNamed("publish", "Validate snapshot package");
    expect(validate.env).toStrictEqual({
      ARTIFACT_DIRECTORY: "${{ runner.temp }}/snapshot-artifact",
      AUTHORIZED_SHA: "${{ needs.authorize.outputs.head_sha }}",
      EXPECTED_PACKAGE_NAME: "@joshwooding/vite-plugin-react-docgen-typescript",
      NPM_CONFIG_USERCONFIG: "/dev/null",
    });
    expect(validate.run).toContain(
      'npm pack "$TARBALL" --dry-run --ignore-scripts --json',
    );
    expect(validate.run).toContain('= "package.tgz"');
    expect(validate.run).toContain(
      "name !== process.env.EXPECTED_PACKAGE_NAME",
    );
    expect(validate.run).toContain("process.env.AUTHORIZED_SHA");
    expect(validate.run).toContain("test ! -L");
  });

  it("scopes the npm credential to the single fixed publish step", () => {
    const credentialReferences: Array<{ path: string; value: string }> = [];
    for (const [jobName, jobValue] of Object.entries(workflow.jobs)) {
      (jobValue as JsonObject).steps &&
        ((jobValue as JsonObject).steps as WorkflowStep[]).forEach(
          (step, index) => {
            visit(step, (entry) => {
              if (
                typeof entry === "string" &&
                /NPM_TOKEN|NODE_AUTH_TOKEN/.test(entry)
              ) {
                credentialReferences.push({
                  path: `${jobName}.steps.${index}`,
                  value: entry,
                });
              }
            });
          },
        );
    }
    const publish = stepNamed("publish", "Publish validated snapshot");
    const publishIndex = steps("publish").indexOf(publish);
    expect(credentialReferences).toStrictEqual([
      {
        path: `publish.steps.${publishIndex}`,
        value: "NODE_AUTH_TOKEN",
      },
      {
        path: `publish.steps.${publishIndex}`,
        value: "${{ secrets.NPM_TOKEN }}",
      },
    ]);
    expect(publish.env).toStrictEqual({
      NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
    });
    expect(publish.run).toBe(
      'npm publish "${{ runner.temp }}/snapshot-artifact/package.tgz" --ignore-scripts --access public --tag snapshot --registry https://registry.npmjs.org/',
    );
    const existence = stepNamed(
      "publish",
      "Check snapshot version availability",
    );
    expect(existence.env).toStrictEqual({ NPM_CONFIG_USERCONFIG: "/dev/null" });
    expect(JSON.stringify(existence)).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it("pins every action to the reviewed release commit", () => {
    const seen = new Set<string>();
    for (const jobName of Object.keys(workflow.jobs)) {
      for (const step of steps(jobName)) {
        if (!step.uses) continue;
        expect(step.uses).toMatch(/^[^/]+\/[^@]+@[0-9a-f]{40}$/);
        const [repository, sha] = step.uses.split("@");
        expect(actionPins.get(repository)).toBe(sha);
        seen.add(repository);
        const escaped = step.uses.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(workflowSource).toMatch(
          new RegExp(`uses: ${escaped} # v\\d+\\.\\d+\\.\\d+`),
        );
      }
    }
    expect(seen).toStrictEqual(new Set(actionPins.keys()));
  });

  it("pins runtimes and the public registry without package-manager caching", () => {
    const nodeSteps = [
      stepNamed("build", "Set up Node.js"),
      stepNamed("publish", "Set up Node.js"),
    ];
    expect(nodeSteps[0].with).toStrictEqual({ "node-version": "24" });
    expect(nodeSteps[1].with).toStrictEqual({
      "node-version": "24",
      "registry-url": "https://registry.npmjs.org/",
    });
    expect(JSON.stringify(workflow.jobs)).not.toContain('"cache"');
    expect(workflowSource).not.toMatch(/python/i);
  });

  it("runs all pull-request code before packaging on the unprivileged build runner", () => {
    const commands = stepNamed("build", "Build snapshot package").run ?? "";
    const expected = [
      "yarn install --immutable",
      "yarn biome:ci",
      "yarn typecheck",
      "yarn test --run",
      "yarn changeset version --snapshot \"snapshot-$AUTHORIZED_SHA\" --snapshot-prerelease-template '{tag}-{datetime}'",
      "yarn build",
      "yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack",
    ];
    let previous = -1;
    for (const command of expected) {
      const index = commands.indexOf(command);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    for (const step of steps("publish")) {
      expect(step.run ?? "").not.toMatch(
        /yarn |changeset| lifecycle|npm (?:install|run|exec)/,
      );
    }
  });

  it("revalidates registry availability and the pull request before publication", () => {
    const availability = stepNamed(
      "publish",
      "Check snapshot version availability",
    ).run;
    expect(availability).toContain("https://registry.npmjs.org/");
    expect(availability).toContain("404");
    const revalidate = stepNamed("publish", "Revalidate pull request");
    const script = String(revalidate.with?.script);
    expect(script).toContain("github.rest.pulls.get");
    expect(script).toContain('pull.data.state !== "open"');
    expect(script).toContain("pull.data.head.repo?.full_name");
    expect(script).toContain(
      "pull.data.head.sha !== process.env.AUTHORIZED_SHA",
    );
  });

  it("fails if Changesets snapshot version semantics drift", () => {
    expect(changesetConfig).not.toHaveProperty("snapshot");
    const unsafe =
      changesetConfig.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH as
        | JsonObject
        | undefined;
    expect(unsafe?.useCalculatedVersionForSnapshots ?? false).toBe(false);
    expect(stepNamed("build", "Build snapshot package").run).toContain(
      "yarn changeset version --snapshot \"snapshot-$AUTHORIZED_SHA\" --snapshot-prerelease-template '{tag}-{datetime}'",
    );
  });
});
