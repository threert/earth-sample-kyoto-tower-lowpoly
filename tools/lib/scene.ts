// Running the place's scene module outside the engine (bake, check): `@threert/scene` from the ThreeRT app's SDK on
// this Mac, or from npm (CI: `bun add @threert/scene` in a scratch folder, THREERT_SCENE=<its index>).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Frame } from "../../earthrt/core/geo.ts";
import type { PlaceManifest } from "../../earthrt/core/places.ts";

export const root = resolve(import.meta.dir, "../..");

const CANDIDATES = [
  process.env.THREERT_SCENE,
  "/Applications/ThreeRT.app/Contents/Resources/sdk/engine/packages/scene/src/index.ts",
  join(process.env.HOME ?? "", "Applications/ThreeRT.app/Contents/Resources/sdk/engine/packages/scene/src/index.ts"),
  join(root, "node_modules/@threert/scene"),
  join(root, ".ci/node_modules/@threert/scene"),
].filter(Boolean) as string[];

/** Where `@threert/scene` is, or null. */
export function sceneModulePath(): string | null {
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

// deno-lint-ignore no-explicit-any
export type ThreeModule = any;

export async function loadThree(): Promise<ThreeModule> {
  const p = sceneModulePath();
  if (!p) throw new Error("@threert/scene not found: install ThreeRT (threert.dev/download), or `bun add @threert/scene` in .ci/ and set THREERT_SCENE");
  return import(p);
}

/** The manifest at the project's root. */
export function readManifest(dir = root): PlaceManifest {
  return JSON.parse(readFileSync(join(dir, "earthrt.json"), "utf8"));
}

/**
 * Runs a built scene module (CommonJS, SPEC § 5) as EarthRT's loader does and returns what `build(ctx)` made.
 * `readFile` reads the place's files from `dir`.
 */
export async function runScene(entryFile: string, m: PlaceManifest, THREE: ThreeModule, dir = root): Promise<ThreeModule> {
  const code = readFileSync(entryFile, "utf8");
  const module = { exports: {} as Record<string, unknown> };
  const req = (name: string) => {
    if (name === "@threert/scene") return THREE;
    throw new Error(`${entryFile}: require("${name}"): a scene module may only import @threert/scene (bundle everything else)`);
  };
  new Function("module", "exports", "require", code)(module, module.exports, req);
  const ex = module.exports as { default?: unknown };
  const build = (typeof ex.default === "function" ? ex.default : typeof module.exports === "function" ? module.exports : null) as ((ctx: unknown) => unknown) | null;
  if (!build) throw new Error(`${entryFile}: no default export (export default function build(ctx) { … })`);
  const frame = new Frame(m.anchor.lat, m.anchor.lon, 0, m.anchor.heading ?? 0);
  const ctx = {
    THREE, place: m, frame, time: 15,
    readFile(path: string): ArrayBuffer {
      if (path.startsWith("/") || path.includes("..")) throw new Error(`readFile(${path}): a path inside the place`);
      const b = readFileSync(join(dir, path));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
  };
  return await build(ctx);
}
