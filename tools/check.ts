// bun run check: is this place ready to publish? The manifest as the registry checks it (validatePlace, EarthRT's
// core), every file it names, the built scene matching its source, the scene running, every model's size, triangles,
// textures and extent against the limits below, and the credits. Errors stop a publish (exit 1); warnings are advice.
//
//   bun run check [--json] [--no-scene]
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { placeRadius, validatePlace, type GlbContent, type PlaceManifest, type SceneContent, type TilesContent } from "../earthrt/core/places.ts";
import { glbStats, readGlb, type GlbStats } from "./lib/glb.ts";
import { loadThree, readManifest, root, runScene, sceneModulePath } from "./lib/scene.ts";

/** The limits a place is held to (the web loads it on phones, the client traces it beside a city). */
export const LIMITS = {
  /** SPEC § 5: a GLB under 64 MiB. */
  glbBytes: 64 * 1024 * 1024,
  glbBytesWarn: 16 * 1024 * 1024,
  /** Triangles in all of a place's models together. */
  triangles: { interior: 1_000_000, site: 1_500_000, city: 8_000_000 },
  trianglesWarn: { interior: 300_000, site: 500_000, city: 3_000_000 },
  /** Texture edge, px. */
  texture: 8192,
  textureWarn: 2048,
  /** GitHub refuses files over 100 MB; the mirror reads files one at a time. */
  fileBytes: 100 * 1000 * 1000,
  /** Extensions a model may require: what both three.js (web) and ThreeRT (client) read without a decoder. */
  requiredOk: [/^KHR_texture_transform$/, /^KHR_mesh_quantization$/, /^KHR_materials_/],
};

export interface Report {
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
  models: { uri: string; bytes: number; stats: GlbStats }[];
}

function glbFile(rel: string, r: Report): GlbStats | null {
  const f = join(root, rel);
  if (!existsSync(f)) {
    r.errors.push(`${rel}: missing`);
    return null;
  }
  const bytes = statSync(f).size;
  if (bytes >= LIMITS.glbBytes) r.errors.push(`${rel}: ${(bytes / 2 ** 20).toFixed(1)} MiB, over the 64 MiB a GLB may be`);
  else if (bytes >= LIMITS.glbBytesWarn) r.warnings.push(`${rel}: ${(bytes / 2 ** 20).toFixed(1)} MiB: phones load this on the web; textures at 2048 px or less and fewer triangles help`);
  let stats: GlbStats;
  try {
    stats = glbStats(readGlb(new Uint8Array(readFileSync(f))));
  } catch (e) {
    r.errors.push(`${rel}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  for (const ext of stats.extensionsRequired) if (!LIMITS.requiredOk.some((x) => x.test(ext))) r.errors.push(`${rel}: requires ${ext}, which the web or the client cannot read: export without it (no Draco / meshopt / Basis compression)`);
  stats.images.forEach((im, i) => {
    if (im.width === null) r.warnings.push(`${rel}: image ${i} (${im.mime}) size unknown${im.mime === "external" ? ": textures must be inside the GLB" : ""}`);
    else if (Math.max(im.width, im.height ?? 0) > LIMITS.texture) r.errors.push(`${rel}: image ${i} is ${im.width}×${im.height}, over ${LIMITS.texture} px`);
    else if (Math.max(im.width, im.height ?? 0) > LIMITS.textureWarn) r.warnings.push(`${rel}: image ${i} is ${im.width}×${im.height}: ${LIMITS.textureWarn} px is plenty for most surfaces`);
  });
  r.models.push({ uri: rel, bytes, stats });
  return stats;
}

/** The farthest a model's box corner gets from the anchor (horizontally) once placed. */
export function placedReach(s: GlbStats, c: Partial<GlbContent>): { reach: number; minY: number; maxY: number } {
  const sc = typeof c.scale === "number" ? [c.scale, c.scale, c.scale] : c.scale ?? [1, 1, 1];
  const [rx, ry, rz] = (c.rotation ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const p = c.position ?? [0, 0, 0];
  let reach = 0, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < 8; k++) {
    let x = (k & 1 ? s.max[0] : s.min[0]) * sc[0], y = (k & 2 ? s.max[1] : s.min[1]) * sc[1], z = (k & 4 ? s.max[2] : s.min[2]) * sc[2];
    // XYZ Euler (three.js order): R = Rx · Ry · Rz applied to the point
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    x += p[0]; y += p[1]; z += p[2];
    reach = Math.max(reach, Math.hypot(x, z));
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { reach, minY, maxY };
}

export async function check(o: { scene?: boolean } = {}): Promise<Report> {
  const r: Report = { ok: false, errors: [], warnings: [], info: [], models: [] };
  let m: PlaceManifest;
  try {
    m = readManifest();
  } catch (e) {
    r.errors.push(`earthrt.json: ${e instanceof Error ? e.message : e}`);
    return r;
  }
  for (const p of validatePlace(m)) r.errors.push(`earthrt.json: ${p}`);
  if (r.errors.length) return r;

  const radius = placeRadius(m);
  const kind = m.kind;
  r.info.push(`${m.id}: ${m.kind} "${m.title}" at ${m.anchor.lat.toFixed(6)}, ${m.anchor.lon.toFixed(6)} (heading ${m.anchor.heading ?? 0}°), bounds ${radius.toFixed(0)} m, topic ${m.topic ?? `${m.kind}:${m.id}`}`);
  if (Math.abs(m.anchor.lat) < 1e-3 && Math.abs(m.anchor.lon) < 1e-3) r.errors.push("anchor: 0, 0 is in the Gulf of Guinea: set the place's anchor (bun run place --at <lat,lon | map URL>)");
  if (!m.summary) r.warnings.push("summary: one line for the map and the list");
  if (!m.start) r.warnings.push(`start: where "Go there" puts the camera (in the place's frame), e.g. { "position": [0, 1.6, 8], "target": [0, 1, 0] }`);
  if (!m.license) r.warnings.push(`license: the licence of the place's content (e.g. "CC-BY-4.0", "CC0-1.0")`);

  let triangles = 0;
  for (const c of m.content) {
    if (c.type === "glb") {
      const s = glbFile(c.uri, r);
      if (!s) continue;
      triangles += s.triangles;
      const { reach, minY, maxY } = placedReach(s, c);
      if (reach > radius * 1.05 + 0.5) r.warnings.push(`${c.uri}: reaches ${reach.toFixed(1)} m from the anchor, outside the bounds (${radius.toFixed(0)} m): grow bounds or move it`);
      if (maxY - minY > 2000) r.warnings.push(`${c.uri}: ${(maxY - minY).toFixed(0)} m tall once placed: is its scale right? (models are in metres)`);
      if (minY > 5 || maxY < -5) r.warnings.push(`${c.uri}: spans y ${minY.toFixed(1)}..${maxY.toFixed(1)} m: y = 0 is the ground at the anchor`);
    } else if (c.type === "scene") {
      const sc = c as SceneContent;
      if (!existsSync(join(root, sc.entry))) r.errors.push(`${sc.entry}: missing (bun run build)`);
      if (sc.source && !existsSync(join(root, sc.source))) r.errors.push(`${sc.source}: missing`);
      if (sc.fallback) {
        const s = glbFile(sc.fallback, r);
        if (s) triangles += s.triangles;
      } else r.warnings.push("the scene has no fallback: the web shows only a marker here (bun run bake)");
      if (existsSync(join(root, sc.entry))) {
        const { builtHash, sourceHash } = await import("./build.ts");
        if (builtHash(sc.entry) !== sourceHash()) r.errors.push(`${sc.entry} was not built from scene/ as it is: bun run build (and commit it)`);
      }
      if (o.scene !== false) {
        if (!sceneModulePath()) r.warnings.push("@threert/scene not found: the scene module was not run (install ThreeRT, or see .github/workflows)");
        else {
          try {
            const THREE = await loadThree();
            const obj = await runScene(join(root, sc.entry), m, THREE);
            if (!obj || !obj.isObject3D) r.errors.push(`${sc.entry}: build(ctx) returned ${obj}, not an Object3D`);
            else {
              obj.updateMatrixWorld();
              let meshes = 0, lights = 0, reach = 0;
              const files: string[] = [];
              obj.traverse((x: { isMesh?: boolean; isLight?: boolean; type?: string; uri?: string; matrixWorld: { elements: number[] } }) => {
                if (x.isMesh) meshes++;
                if (x.isLight) lights++;
                if (x.type === "GLTFModel" && x.uri) files.push(x.uri);
                const e = x.matrixWorld.elements;
                reach = Math.max(reach, Math.hypot(e[12], e[14]));
              });
              r.info.push(`${sc.entry}: ${meshes} meshes, ${lights} lights${files.length ? `, models ${files.join(", ")}` : ""}`);
              for (const f of files) if (!existsSync(join(root, f))) r.errors.push(`${sc.entry}: GLTFModel("${f}"): missing`);
              if (reach > radius * 1.05 + 0.5) r.warnings.push(`${sc.entry}: objects ${reach.toFixed(1)} m from the anchor, outside the bounds (${radius.toFixed(0)} m)`);
              if (sc.fallback && existsSync(join(root, sc.fallback))) {
                const { toGlb } = await import("./bake.ts");
                const now = toGlb(obj, THREE, []);
                const was = readFileSync(join(root, sc.fallback));
                if (Buffer.compare(Buffer.from(now.bytes), was) !== 0) r.warnings.push(`${sc.fallback} is not what the scene builds now: bun run bake`);
              }
            }
          } catch (e) {
            r.errors.push(`${sc.entry}: ${e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join("\n  ") : e}`);
          }
        }
      }
    } else if (c.type === "tiles") {
      const t = c as TilesContent;
      if (!existsSync(join(root, t.uri))) r.errors.push(`${t.uri}: missing`);
      else {
        try {
          const ts = JSON.parse(readFileSync(join(root, t.uri), "utf8"));
          if (ts.format !== "earthrt/tileset@1") r.errors.push(`${t.uri}: format must be "earthrt/tileset@1"`);
          let missing = 0;
          for (const k of ts.keys ?? []) {
            const [z, x, y] = String(k).split("/");
            for (const enc of ["c", "x"]) if (!existsSync(join(root, String(ts.tiles).replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{enc}", enc)))) missing++;
          }
          if (missing) r.errors.push(`${t.uri}: ${missing} tile files missing`);
        } catch (e) {
          r.errors.push(`${t.uri}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }
  const tmax = LIMITS.triangles[kind], twarn = LIMITS.trianglesWarn[kind];
  if (triangles > tmax) r.errors.push(`${triangles.toLocaleString("en")} triangles in the models, over ${tmax.toLocaleString("en")} for a ${kind}`);
  else if (triangles > twarn) r.warnings.push(`${triangles.toLocaleString("en")} triangles in the models: over ${twarn.toLocaleString("en")} a ${kind} gets slow on phones`);

  // Credits: Meshy's models say so in their generator; OSM-derived content must credit OSM.
  const credits = (m.credits ?? []).join(" ").toLowerCase();
  for (const mo of r.models) {
    const gen = readGlb(new Uint8Array(readFileSync(join(root, mo.uri)))).json.asset?.generator ?? "";
    const side = join(root, mo.uri.replace(/\.glb$/i, ".meshy.json"));
    const meta = existsSync(side) ? JSON.parse(readFileSync(side, "utf8")) : null;
    if ((meta || /meshy/i.test(gen)) && !credits.includes("meshy")) r.errors.push(`${mo.uri} was made with Meshy: add "Model made with Meshy" to credits`);
    if (meta?.test) r.errors.push(`${mo.uri} is a placeholder from "bun run meshy … --mock", not a model of this place: make it with your own key`);
  }
  const sourceText = existsSync(join(root, "scene")) ? Bun.spawnSync(["grep", "-rli", "openstreetmap\\|overpass", join(root, "scene"), join(root, "assets")]).stdout.toString() : "";
  if (sourceText.trim() && !credits.includes("openstreetmap")) r.errors.push(`OpenStreetMap data is used (${sourceText.trim().split("\n")[0].replace(root + "/", "")}): add "© OpenStreetMap contributors" to credits`);

  // Files GitHub refuses.
  const big = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root }).stdout.toString().split("\0").filter(Boolean);
  for (const f of big) {
    const p = join(root, f);
    if (existsSync(p) && statSync(p).size > LIMITS.fileBytes) r.errors.push(`${f}: over 100 MB, which GitHub refuses (use Git LFS or make it smaller)`);
  }

  r.info.push(`models: ${r.models.length}, ${triangles.toLocaleString("en")} triangles, ${(r.models.reduce((a, b) => a + b.bytes, 0) / 2 ** 20).toFixed(1)} MiB`);
  r.ok = r.errors.length === 0;
  return r;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const r = await check({ scene: !args.includes("--no-scene") });
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    for (const l of r.info) console.log(`  ${l}`);
    for (const l of r.warnings) console.log(`! ${l}`);
    for (const l of r.errors) console.log(`✗ ${l}`);
    console.log(r.ok ? `✓ ready${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""})` : ""}` : `✗ ${r.errors.length} error${r.errors.length > 1 ? "s" : ""}`);
  }
  process.exit(r.ok ? 0 : 1);
}
