// bun run meshy: models from Meshy (https://docs.meshy.ai), saved into assets/models/ in metres and placed in
// earthrt.json. Text to 3D is two tasks (a preview: the shape; a refine: its textures, PBR); image to 3D is one.
// The key is MESHY_API_KEY (your own: https://www.meshy.ai/developers/keys, a paid plan; each task costs credits).
// `--mock` runs everything against a local stand-in for the API (no key, no credits; a placeholder cube): for trying
// the tool and its tests. Meshy keeps a task's files for 3 days: `resume` within that.
//
//   bun run meshy text "a weathered granite stone lantern, Japanese garden" --name lantern --height 1.6
//   bun run meshy image photo.jpg --name bench --size 1.8           (a file, an https URL, or several: multi-image)
//     [--at x,z] [--y 0] [--rotate 90]        where it stands in the place's frame (m), turned about up (degrees)
//     [--height m | --size m]                 its height, or its largest horizontal extent (default: height 1)
//     [--no-place]                            only save the GLB (no entry in earthrt.json)
//     [--polycount 30000] [--topology triangle|quad] [--model latest]
//     [--texture "texture prompt"] [--no-pbr] [--no-refine] [--seed n] [--mock]
//   bun run meshy resume <task-id> [--image] --name x …   download a task that finished (or is still running)
//   bun run meshy fit <models/x.glb> --height 1.6 …       place or re-size a GLB you have (any source)
//   bun run meshy balance                                 your credits
//
// Every model gets a sidecar (assets/models/<name>.meshy.json: the task, the prompt, when) and "Model made with
// Meshy" in earthrt.json's credits.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { validatePlace, type GlbContent } from "../earthrt/core/places.ts";
import { glbStats, readGlb } from "./lib/glb.ts";
import { readManifest, root } from "./lib/scene.ts";
import { writeManifest } from "./lib/json.ts";

let MESHY = process.env.MESHY_API_BASE ?? "https://api.meshy.ai";
export const CREDIT = "Model made with Meshy";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (n: string) => {
  const v = flag(n);
  if (v === undefined) return undefined;
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`${n}: a number, not ${v}`);
  return x;
};

function key(): string {
  if (args.includes("--mock")) return "msy_mock";
  const k = process.env.MESHY_API_KEY;
  if (!k) throw new Error("MESHY_API_KEY is not set: make a key at https://www.meshy.ai/developers/keys (or --mock to try the tool without one)");
  return k;
}

async function meshy(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${MESHY}${path}`, {
      method,
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (r.status === 429 && attempt < 5) {
      await Bun.sleep(2000 * (attempt + 1));
      continue;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text.slice(0, 300) };
    }
    if (!r.ok) {
      const why = r.status === 401 ? "the key was refused" : r.status === 402 ? "not enough credits (bun run meshy balance)" : r.status === 429 ? "too many requests" : `HTTP ${r.status}`;
      throw new Error(`Meshy ${method} ${path}: ${why}: ${json.message ?? text.slice(0, 300)}`);
    }
    return json;
  }
}

interface Task {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED" | "EXPIRED";
  progress?: number;
  model_urls?: { glb?: string; fbx?: string; obj?: string; usdz?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
}

/** Waits for a task to finish, printing its progress. */
async function poll(path: string): Promise<Task> {
  let last = -1;
  for (;;) {
    const t = (await meshy("GET", path)) as unknown as Task;
    if (t.progress !== undefined && t.progress !== last) {
      process.stdout.write(`\r  ${t.status.toLowerCase().replace("_", " ")} ${t.progress}%   `);
      last = t.progress;
    }
    if (t.status === "SUCCEEDED") {
      process.stdout.write("\n");
      return t;
    }
    if (t.status === "FAILED" || t.status === "CANCELED" || t.status === "EXPIRED") {
      process.stdout.write("\n");
      throw new Error(`Meshy task ${t.id} ${t.status.toLowerCase()}: ${t.task_error?.message ?? ""}`);
    }
    await Bun.sleep(args.includes("--mock") ? 200 : 5000);
  }
}

/** Text to 3D: a preview (geometry), then a refine (textures). Returns the finished task. */
async function textTo3d(prompt: string): Promise<{ task: Task; ids: string[] }> {
  if (prompt.length > 800) throw new Error("the prompt is at most 800 characters");
  const preview = {
    mode: "preview", prompt,
    ai_model: flag("--model") ?? "latest",
    should_remesh: true,
    topology: flag("--topology") ?? "triangle",
    target_polycount: num("--polycount") ?? 30000,
    target_formats: ["glb"],
    ...(num("--seed") !== undefined ? { seed: num("--seed") } : {}),
  };
  const p = (await meshy("POST", "/openapi/v2/text-to-3d", preview)).result as string;
  console.log(`  preview task ${p}`);
  const pt = await poll(`/openapi/v2/text-to-3d/${p}`);
  if (args.includes("--no-refine")) return { task: pt, ids: [p] };
  const refine = {
    mode: "refine", preview_task_id: p,
    enable_pbr: !args.includes("--no-pbr"),
    ai_model: flag("--model") ?? "latest",
    target_formats: ["glb"],
    ...(flag("--texture") ? { texture_prompt: flag("--texture") } : {}),
  };
  const r = (await meshy("POST", "/openapi/v2/text-to-3d", refine)).result as string;
  console.log(`  refine task ${r}`);
  return { task: await poll(`/openapi/v2/text-to-3d/${r}`), ids: [p, r] };
}

/** An image as Meshy takes it: an https URL as it is, a file as a data URI. */
function imageUrl(s: string): string {
  if (/^https:\/\//.test(s) || s.startsWith("data:")) return s;
  if (!existsSync(s)) throw new Error(`${s}: no such file`);
  const ext = extname(s).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : null;
  if (!mime) throw new Error(`${s}: a .png, .jpg or .webp (at most 20 MB)`);
  return `data:${mime};base64,${readFileSync(s).toString("base64")}`;
}

/** Image (or images of one object) to 3D. */
async function imageTo3d(images: string[]): Promise<{ task: Task; ids: string[] }> {
  const common = {
    ai_model: flag("--model") ?? "latest",
    topology: flag("--topology") ?? "triangle",
    target_polycount: num("--polycount") ?? 30000,
    should_remesh: true,
    should_texture: true,
    enable_pbr: !args.includes("--no-pbr"),
    target_formats: ["glb"],
    ...(flag("--texture") ? { texture_prompt: flag("--texture") } : {}),
  };
  const multi = images.length > 1;
  const path = multi ? "/openapi/v1/multi-image-to-3d" : "/openapi/v1/image-to-3d";
  const body = multi ? { image_urls: images.map(imageUrl), ...common } : { image_url: imageUrl(images[0]), ...common };
  const id = (await meshy("POST", path, body)).result as string;
  console.log(`  ${multi ? "multi-image" : "image"} to 3D task ${id}`);
  return { task: await poll(`${path}/${id}`), ids: [id] };
}

async function download(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`downloading the model: HTTP ${r.status} (Meshy's links expire: bun run meshy resume <task>)`);
  return new Uint8Array(await r.arrayBuffer());
}

export interface Fit {
  height?: number;
  size?: number;
  at?: [number, number];
  y?: number;
  rotate?: number;
}

/**
 * The entry that stands a model in the place: scaled to a height (or its largest horizontal extent) in metres, its
 * footprint's centre at `at`, its lowest point at `y` (the ground), turned `rotate` degrees about up (counter-
 * clockwise seen from above, as three.js turns about +y).
 */
export function fitEntry(uri: string, glb: Uint8Array, f: Fit): GlbContent & { position: [number, number, number]; rotation: [number, number, number]; scale: number } {
  const s = glbStats(readGlb(glb));
  if (!Number.isFinite(s.min[0])) throw new Error(`${uri}: no geometry to size`);
  const w = s.max[0] - s.min[0], h = s.max[1] - s.min[1], d = s.max[2] - s.min[2];
  const scale = f.size !== undefined ? f.size / Math.max(w, d) : (f.height ?? 1) / h;
  const cx = (s.min[0] + s.max[0]) / 2, cz = (s.min[2] + s.max[2]) / 2;
  const r = ((f.rotate ?? 0) * Math.PI) / 180;
  // the model's footprint centre, scaled and turned, is moved onto `at`
  const ox = (cx * Math.cos(r) + cz * Math.sin(r)) * scale, oz = (-cx * Math.sin(r) + cz * Math.cos(r)) * scale;
  const at = f.at ?? [0, 0];
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    type: "glb", uri,
    position: [round(at[0] - ox), round((f.y ?? 0) - s.min[1] * scale), round(at[1] - oz)],
    rotation: [0, round(f.rotate ?? 0), 0],
    scale: Math.round(scale * 1e6) / 1e6,
  };
}

/** Writes the GLB (and its sidecar) and, unless told not to, its entry in earthrt.json (replacing one with its uri). */
export function save(name: string, glb: Uint8Array, meta: Record<string, unknown> | null, f: Fit, place = true): string {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new Error(`--name: letters, digits, - and _ (${name})`);
  const uri = `assets/models/${name}.glb`;
  mkdirSync(join(root, "assets/models"), { recursive: true });
  writeFileSync(join(root, uri), glb);
  if (meta) writeFileSync(join(root, `assets/models/${name}.meshy.json`), JSON.stringify({ ...meta, saved: new Date().toISOString() }, null, 2) + "\n");
  const s = glbStats(readGlb(glb));
  const e = fitEntry(uri, glb, f);
  console.log(`✓ ${uri}: ${s.triangles.toLocaleString("en")} triangles, ${s.images.length} textures${s.images.length ? ` (${s.images.map((i) => `${i.width}×${i.height}`).join(", ")})` : ""}, ${(glb.byteLength / 2 ** 20).toFixed(1)} MiB; scale ${e.scale} → ${(((s.max[1] - s.min[1]) * e.scale)).toFixed(2)} m tall`);
  if (!place) return uri;
  const m = readManifest();
  const i = m.content.findIndex((c) => c.type === "glb" && c.uri === uri);
  if (i >= 0) m.content[i] = e;
  else m.content.push(e);
  if (meta) {
    m.credits ??= [];
    if (!m.credits.some((c) => /meshy/i.test(c))) m.credits.push(CREDIT);
  }
  const problems = validatePlace(m);
  if (problems.length) throw new Error(`earthrt.json would not be valid: ${problems.join("; ")}`);
  writeManifest(root, m);
  console.log(`✓ earthrt.json: ${uri} at ${e.position.join(", ")}, turned ${e.rotation[1]}°, scale ${e.scale}`);
  return uri;
}

function fitOpts(): Fit {
  const at = flag("--at")?.split(",").map(Number);
  if (at && (at.length !== 2 || at.some((v) => !Number.isFinite(v)))) throw new Error("--at x,z (metres east, south of the anchor)");
  return { height: num("--height"), size: num("--size"), at: at as [number, number] | undefined, y: num("--y"), rotate: num("--rotate") };
}

if (import.meta.main) {
  if (args.includes("--mock")) {
    const { startMock } = await import("./lib/meshy-mock.ts");
    MESHY = startMock();
  }
  const [cmd, ...rest] = args;
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--") && !["--mock", "--no-place", "--no-pbr", "--no-refine", "--image"].includes(rest[i - 1])));
  try {
    if (cmd === "balance") {
      const b = await meshy("GET", "/openapi/v1/balance");
      console.log(`${b.balance} credits`);
    } else if (cmd === "text" || cmd === "image" || cmd === "resume") {
      const name = flag("--name") ?? (cmd === "image" ? basename(positional[0] ?? "model", extname(positional[0] ?? "")) : "model").toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
      let task: Task, ids: string[], prompt: string | undefined;
      if (cmd === "text") {
        prompt = positional.join(" ");
        if (!prompt) throw new Error('bun run meshy text "<what it is>" --name <name> --height <m>');
        ({ task, ids } = await textTo3d(prompt));
      } else if (cmd === "image") {
        if (!positional.length) throw new Error("bun run meshy image <file.png | https://…> [more views…] --name <name> --height <m>");
        ({ task, ids } = await imageTo3d(positional));
      } else {
        const id = positional[0];
        if (!id) throw new Error("bun run meshy resume <task-id> [--image] --name <name>");
        task = await poll(args.includes("--image") ? `/openapi/v1/image-to-3d/${id}` : `/openapi/v2/text-to-3d/${id}`);
        ids = [id];
      }
      const url = task.model_urls?.glb;
      if (!url) throw new Error(`task ${task.id} has no GLB`);
      const glb = await download(url);
      save(name, glb, { source: "meshy", tasks: ids, prompt, images: cmd === "image" ? positional.map((p) => (p.startsWith("http") ? p : basename(p))) : undefined, test: args.includes("--mock") || undefined }, fitOpts(), !args.includes("--no-place"));
      if (args.includes("--mock")) console.log("! --mock: a placeholder cube from the local stand-in, not a model (check refuses it in a place)");
    } else if (cmd === "fit") {
      const uri = positional[0];
      if (!uri || !existsSync(join(root, uri))) throw new Error("bun run meshy fit <assets/models/x.glb> --height <m> [--at x,z] [--rotate deg]");
      const glb = new Uint8Array(readFileSync(join(root, uri)));
      const name = basename(uri, ".glb");
      if (!uri.startsWith("assets/models/")) throw new Error("models live in assets/models/");
      save(name, glb, existsSync(join(root, `assets/models/${name}.meshy.json`)) ? JSON.parse(readFileSync(join(root, `assets/models/${name}.meshy.json`), "utf8")) : null, fitOpts(), true);
    } else {
      console.log(readFileSync(import.meta.path, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
      process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
