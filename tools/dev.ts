// bun run dev: EarthRT's dev mode (SPEC § 7). Serves this place's files on this machine and opens EarthRT with
// `dev=<url>`: the globe, flown to the place, with the place read from here instead of the index's mirror, reloaded
// on every save. (`threert dev` shows the place alone, path-traced: preview.ts. This shows it on the Earth.)
//
//   bun run dev                        the web (earth.threert.dev) in your browser
//   bun run dev --client               the ThreeRT client (EarthRT's package), path-traced
//   bun run dev --proxy                the web app served from this machine too (same origin: for a browser that will
//                                      not let an https page read http://127.0.0.1)
//     [--port 8797] [--no-open] [--no-bake] [--web https://earth.threert.dev] [--package https://earth.threert.dev/]
//
// What it serves (http://127.0.0.1:<port>):
//   /place/<path>        the place's files (earthrt.json, dist/, assets/, …; never dotfiles), CORS open, no cache
//   /_dev/wait?v=<n>     long poll: answers { v } as soon as the files changed since version n (or after 25 s)
//   /_dev/status         { v, place, url, error }
//   /                    with --proxy: the EarthRT web app, fetched from --web
import { existsSync, statSync, watch } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { validatePlace } from "../earthrt/core/places.ts";
import { bake } from "./bake.ts";
import { buildScene } from "./build.ts";
import { readManifest, root } from "./lib/scene.ts";

const TYPES: Record<string, string> = {
  ".json": "application/json", ".js": "text/javascript; charset=utf-8", ".cjs": "text/javascript; charset=utf-8", ".ts": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ktx2": "image/ktx2", ".ert": "application/octet-stream", ".erp": "application/octet-stream",
};

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const WEB = (flag("--web") ?? process.env.EARTHRT_WEB ?? "https://earth.threert.dev").replace(/\/$/, "");
const PACKAGE = flag("--package") ?? process.env.EARTHRT_PACKAGE ?? "https://earth.threert.dev/";
const proxy = args.includes("--proxy");

// CORS for any page, and Chrome's Private Network Access / Local Network Access preflight (an https page asking
// http://127.0.0.1 sends `Access-Control-Request-Private-Network: true` and needs the matching allow header).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-allow-private-network": "true",
  "access-control-max-age": "600",
};

/** The GLBs bake writes (a change to them is ours, not the author's). */
const fallbacks = () => {
  try {
    return readManifest().content.flatMap((c) => (c.type === "scene" && c.fallback ? [c.fallback] : []));
  } catch {
    return [];
  }
};

let version = 1;
let error: string | null = null;
const waiters = new Set<() => void>();
const bump = () => {
  version++;
  for (const w of [...waiters]) w();
};

/** A place file, or null when the path leaves the folder or names something private. */
function placeFile(rel: string): string | null {
  const clean = normalize(rel).replace(/^[/\\]+/, "");
  if (!clean || clean.split(/[/\\]/).some((s) => s === ".." || s.startsWith(".") || s === "node_modules")) return null;
  const f = join(root, clean);
  if (!f.startsWith(root + sep)) return null;
  return existsSync(f) && statSync(f).isFile() ? f : null;
}

async function rebuild(what: string) {
  try {
    const m = readManifest();
    const p = validatePlace(m);
    if (p.length) throw new Error(`earthrt.json: ${p.join("; ")}`);
    if (what.startsWith("scene") || what === "earthrt.json") {
      await buildScene({ quiet: true });
      if (!args.includes("--no-bake") && m.content.some((c) => c.type === "scene")) {
        const b = await bake({ build: false, quiet: true });
        for (const w of b.warnings) console.log(`! ${w}`);
      }
    }
    error = null;
    console.log(`✓ ${what} · version ${version + 1}`);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.log(`✗ ${what}: ${error}`);
  }
  bump();
}

function serve(port: number) {
  return Bun.serve({
    port, hostname: "127.0.0.1", idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/_dev/status") return json({ v: version, error, place: readManifest().id, url: `${url.origin}/place/` });
      if (path === "/_dev/wait") {
        const known = Number(url.searchParams.get("v") ?? 0);
        if (known !== version) return json({ v: version, error });
        return new Promise<Response>((ok) => {
          const done = () => {
            waiters.delete(done);
            clearTimeout(t);
            ok(json({ v: version, error }));
          };
          const t = setTimeout(done, 25_000);
          waiters.add(done);
        });
      }
      if (path.startsWith("/place/")) {
        const f = placeFile(path.slice("/place/".length));
        if (!f) return new Response("not found", { status: 404, headers: CORS });
        return new Response(Bun.file(f), { headers: { ...CORS, "content-type": TYPES[extname(f).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" } });
      }
      if (proxy) {
        // The web app from --web, on this origin. Its tiles and API stay at their own (CORS-open) addresses.
        const up = await fetch(`${WEB}${url.pathname}${url.search}`, { headers: { accept: req.headers.get("accept") ?? "*/*" } });
        const h = new Headers(up.headers);
        h.delete("content-encoding");
        h.delete("content-length");
        return new Response(up.body, { status: up.status, headers: h });
      }
      return new Response(`EarthRT dev server for ${readManifest().id}: the place is at /place/`, { headers: { ...CORS, "content-type": "text/plain" } });
    },
  });
}

if (import.meta.main) {
  await rebuild("scene");
  let server: ReturnType<typeof serve> | null = null;
  const first = Number(flag("--port") ?? 8797);
  for (let p = first; p < first + 20 && !server; p++) {
    try {
      server = serve(p);
    } catch {
      server = null;
    }
  }
  if (!server) throw new Error(`no free port from ${first}`);
  const origin = `http://127.0.0.1:${server.port}`;
  const dev = `${origin}/place/`;
  const m = readManifest();
  const st = m.start;
  const page = `${proxy ? origin : WEB}/?dev=${encodeURIComponent(dev)}`;
  console.log(`\n  EarthRT dev mode · ${m.title}`);
  console.log(`  place   ${dev}earthrt.json`);
  console.log(`  web     ${page}`);
  console.log(`  client  threert open ${PACKAGE} --launch '${JSON.stringify({ dev })}'`);
  if (st) console.log(`  start   camera at ${st.position.join(", ")} looking at ${st.target.join(", ")} (place frame)`);
  console.log("  every save rebuilds the scene and its fallback, and EarthRT reloads the place (Ctrl-C to stop)\n");

  if (!args.includes("--no-open")) {
    if (args.includes("--client")) {
      const threert = existsSync("/Applications/ThreeRT.app/Contents/MacOS/threert") ? "/Applications/ThreeRT.app/Contents/MacOS/threert" : "threert";
      const r = Bun.spawnSync([threert, "open", PACKAGE, "--launch", JSON.stringify({ dev })], { stdout: "pipe", stderr: "pipe" });
      console.log(r.exitCode === 0 ? `  ✓ opened in ThreeRT` : `  ! ThreeRT: ${(r.stderr.toString() || r.stdout.toString()).trim()}`);
    } else {
      Bun.spawnSync([process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", page]);
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = new Set<string>();
  watch(root, { recursive: true }, (_e, file) => {
    const f = String(file ?? "").split(sep).join("/");
    if (!f || f.startsWith(".") || f.includes("/.") || f.startsWith("node_modules") || f.startsWith("dist/") || fallbacks().includes(f)) return;
    if (!(f === "earthrt.json" || f.startsWith("scene/") || f.startsWith("assets/") || f.startsWith("tiles/"))) return;
    pending.add(f.startsWith("scene/") ? "scene" : f);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const what = [...pending].join(", ");
      pending = new Set();
      rebuild(what.includes("scene") || what.includes("earthrt.json") ? (what.includes("earthrt.json") ? "earthrt.json" : "scene") : what);
    }, 120);
  });
}
