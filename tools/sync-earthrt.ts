// bun run sync-earthrt: refresh earthrt/ (the parts of EarthRT's core this template uses: the manifest's check, the
// place's frame, the sun) from github.com/threert/EarthRT. A copy and not a submodule: a remix is a shallow clone
// (`threert remix <repo>`), and "Use this template" does not bring submodules along.
//
//   bun run sync-earthrt [--ref main] [--from ../EarthRT]     (--from: a local checkout instead of GitHub)
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILES = ["packages/core/src/geo.ts", "packages/core/src/places.ts", "packages/core/src/sun.ts", "LICENSE"];
const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

let src = flag("--from");
let tmp: string | null = null;
if (!src) {
  tmp = mkdtempSync(join(tmpdir(), "earthrt-"));
  const ref = flag("--ref") ?? "main";
  const r = Bun.spawnSync(["git", "clone", "--depth", "1", "--branch", ref, "https://github.com/threert/EarthRT.git", tmp], { stderr: "pipe" });
  if (r.exitCode !== 0) {
    console.error(`✗ git clone: ${r.stderr.toString().trim()}`);
    process.exit(1);
  }
  src = tmp;
}
const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: src }).stdout.toString().trim();
for (const f of FILES) {
  if (!existsSync(join(src, f))) {
    console.error(`✗ ${f} is not in ${src}`);
    process.exit(1);
  }
  const to = f === "LICENSE" ? join(root, "earthrt/LICENSE") : join(root, "earthrt/core", f.split("/").pop()!);
  cpSync(join(src, f), to);
}
const was = existsSync(join(root, "earthrt/VERSION")) ? readFileSync(join(root, "earthrt/VERSION"), "utf8").trim() : "";
writeFileSync(join(root, "earthrt/VERSION"), `${commit}\n`);
if (tmp) rmSync(tmp, { recursive: true, force: true });
console.log(`✓ earthrt/ at threert/EarthRT ${commit.slice(0, 7)}${was && was !== commit ? ` (was ${was.slice(0, 7)})` : ""}`);
