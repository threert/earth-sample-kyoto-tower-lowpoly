// bun run register: publish the place. Checks it, pushes the commit, makes sure the repository is public and has
// the `earthrt-place` topic, then registers it with EarthRT's index (SPEC § 8): the first time `POST /places`, later
// `POST /places/<owner>/<repo>/<id>/refresh` (a new commit is a new version). The index reads earthrt.json at the
// default branch's head and serves the files at that commit from its mirror.
//
//   bun run register [--create owner/name] [--api https://earth.threert.dev/api/v1] [--no-push] [--dry-run]
//
// --create makes the GitHub repository first (public), with this folder as its content.
// The token is `gh auth token` (or GITHUB_TOKEN): the index asks GitHub who it is and whether it may push here.
import { placeRadius } from "../earthrt/core/places.ts";
import { readManifest, root } from "./lib/scene.ts";

export const API = process.env.EARTHRT_API ?? "https://earth.threert.dev/api/v1";

function run(cmd: string[], o: { allowFail?: boolean } = {}): string {
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0 && !o.allowFail) throw new Error(`${cmd.join(" ")}: ${(r.stderr.toString() || r.stdout.toString()).trim()}`);
  return r.exitCode === 0 ? r.stdout.toString().trim() : "";
}

/** owner/name of the `origin` remote on GitHub, or null. */
export function originRepo(): string | null {
  const url = run(["git", "remote", "get-url", "origin"], { allowFail: true });
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function token(): string {
  const t = process.env.GITHUB_TOKEN || run(["gh", "auth", "token"], { allowFail: true });
  if (!t) throw new Error("no GitHub token: `gh auth login` (or set GITHUB_TOKEN)");
  return t;
}

export async function api(method: string, path: string, body?: unknown, base = API): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "earth-place-template" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text.slice(0, 300) };
  }
  return { status: r.status, json };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const base = flag("--api") ?? API;
  const dry = args.includes("--dry-run");
  try {
    // 1. The place must pass its check.
    const { check } = await import("./check.ts");
    const r = await check();
    for (const w of r.warnings) console.log(`! ${w}`);
    if (!r.ok) throw new Error(`the check failed:\n  ${r.errors.join("\n  ")}`);
    const m = readManifest();

    // 2. Everything committed (the index reads the pushed commit, not this folder).
    const dirty = run(["git", "status", "--porcelain"]);
    if (dirty) throw new Error(`uncommitted changes: commit them first (git add -A && git commit -m "…")\n${dirty}`);

    // 3. The repository on GitHub.
    const create = flag("--create");
    let repo = originRepo();
    if (create && !repo) {
      if (dry) console.log(`(dry run) would create ${create}`);
      else {
        run(["gh", "repo", "create", create, "--public", "--source", ".", "--push", "--description", m.summary ?? m.title]);
        repo = create;
        console.log(`✓ created https://github.com/${create}`);
      }
    }
    if (!repo) throw new Error("no GitHub remote: `bun run register --create <owner>/<name>`, or `gh repo create` and add it as origin");
    if (!args.includes("--no-push") && !dry) {
      run(["git", "push", "-u", "origin", "HEAD"]);
      console.log("✓ pushed");
    }
    const head = run(["git", "rev-parse", "HEAD"]);
    const info = JSON.parse(run(["gh", "repo", "view", repo, "--json", "visibility,repositoryTopics,defaultBranchRef,url"]));
    if (info.visibility !== "PUBLIC") throw new Error(`${repo} is ${info.visibility.toLowerCase()}: the index reads public repositories only (gh repo edit ${repo} --visibility public --accept-visibility-change-consequences)`);
    const branch = info.defaultBranchRef?.name;
    const current = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch && current !== branch) console.log(`! you are on ${current}; the index reads ${branch}: merge into it to publish this`);
    const topics: string[] = (info.repositoryTopics ?? []).map((t: { name: string }) => t.name);
    if (!topics.includes("earthrt-place") && !dry) {
      run(["gh", "repo", "edit", repo, "--add-topic", "earthrt-place"]);
      console.log("✓ topic earthrt-place");
    }

    // 4. Register, or refresh what is registered.
    const id = `${repo}/${m.id}`;
    if (dry) {
      console.log(`(dry run) would register ${id} at ${head.slice(0, 7)} with ${base}`);
      process.exit(0);
    }
    const known = await api("GET", `/places/${id}`, undefined, base);
    const res = known.status === 200 ? await api("POST", `/places/${id}/refresh`, {}, base) : await api("POST", "/places", { repo }, base);
    if (res.status >= 300) throw new Error(`${base}: HTTP ${res.status}: ${JSON.stringify(res.json)}`);
    const rec = (res.json.place ?? res.json) as { id?: string; sha?: string; files?: string; topic?: string };
    console.log(`✓ ${known.status === 200 ? "refreshed" : "registered"} ${rec.id ?? id} at ${(rec.sha ?? "?").slice(0, 7)}${rec.sha && rec.sha !== head ? ` (your HEAD is ${head.slice(0, 7)}: the index read ${branch})` : ""}`);
    if (rec.files) console.log(`  files     ${rec.files}`);
    console.log(`  topic     ${rec.topic ?? m.topic ?? `${m.kind}:${m.id}`}`);
    console.log(`  on Earth  https://earth.threert.dev/?place=${id}`);
    console.log(`  bounds    ${placeRadius(m).toFixed(0)} m about ${m.anchor.lat}, ${m.anchor.lon}`);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
