// bun run build: scene/main.ts → dist/scene.js, the scene module EarthRT loads (SPEC § 5): one CommonJS file,
// `@threert/scene` left to the loader's `require`, everything else bundled. Commit dist/: the mirror serves the
// repository's files as they are, nothing builds them there.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { SceneContent } from "../earthrt/core/places.ts";
import { readManifest, root } from "./lib/scene.ts";

/** A hash of everything under scene/ (paths and contents): what dist/scene.js was built from. */
export function sourceHash(): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) h.update(relative(root, f)).update("\0").update(readFileSync(f)).update("\0");
    }
  };
  if (existsSync(join(root, "scene"))) walk(join(root, "scene"));
  return h.digest("hex").slice(0, 16);
}

/** The source hash dist/scene.js says it was built from, or null. */
export function builtHash(entry: string): string | null {
  const f = join(root, entry);
  if (!existsSync(f)) return null;
  return /sources ([0-9a-f]{16})/.exec(readFileSync(f, "utf8").slice(0, 300))?.[1] ?? null;
}

export async function buildScene(o: { quiet?: boolean } = {}): Promise<{ entry: string; bytes: number } | null> {
  const m = readManifest();
  const sc = m.content.find((c) => c.type === "scene") as SceneContent | undefined;
  if (!sc) {
    if (!o.quiet) console.log("no scene content in earthrt.json: nothing to build");
    return null;
  }
  const source = join(root, sc.source ?? "scene/main.ts");
  const r = await Bun.build({ entrypoints: [source], format: "cjs", target: "browser", external: ["@threert/scene"], minify: { syntax: true, whitespace: false, identifiers: false } });
  if (!r.success) throw new Error(r.logs.map((l) => String(l)).join("\n"));
  const text = `// Built from ${sc.source ?? "scene/main.ts"} (sources ${sourceHash()}) by \`bun run build\`: edit the source, not this file.\n` + (await r.outputs[0].text());
  const out = join(root, sc.entry);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  if (!o.quiet) console.log(`✓ ${sc.entry}: ${(text.length / 1024).toFixed(1)} KiB`);
  return { entry: sc.entry, bytes: text.length };
}

if (import.meta.main && process.argv.includes("--verify")) {
  // CI: is dist/ built from the scene/ that is committed? (A hash of the sources: bundlers differ byte for byte.)
  const sc = readManifest().content.find((c) => c.type === "scene") as SceneContent | undefined;
  if (sc && builtHash(sc.entry) !== sourceHash()) {
    console.error(`✗ ${sc.entry} was not built from scene/ as it is: bun run build, and commit ${sc.entry}`);
    process.exit(1);
  }
  console.log(sc ? `✓ ${sc.entry} is built from scene/ (${sourceHash()})` : "no scene");
} else if (import.meta.main) {
  buildScene().catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
