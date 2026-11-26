// A local stand-in for Meshy's API (`bun run meshy … --mock`): the endpoints tools/meshy.ts uses, answering as
// docs.meshy.ai describes (a task id, then PENDING → IN_PROGRESS → SUCCEEDED with `model_urls.glb`), with a 1 m
// placeholder cube as the model. No key, no credits, no network: for trying the tool and testing it.
import { GlbWriter } from "./glb.ts";

function cube(): Uint8Array {
  const w = new GlbWriter();
  w.json.asset = { version: "2.0", generator: "Meshy mock (earth-place-template)" };
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const b = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) pos.push(0.5 * n[k] + 0.5 * su * u[k] + 0.5 * sv * v[k] + (k === 1 ? 0.5 : 0));
      nrm.push(...n);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  w.json.materials!.push({ pbrMetallicRoughness: { baseColorFactor: [0.9, 0.3, 0.6, 1], roughnessFactor: 0.6, metallicFactor: 0 } });
  w.json.meshes!.push({ primitives: [{ attributes: { POSITION: w.accessor(new Float32Array(pos), "VEC3", 34962, true), NORMAL: w.accessor(new Float32Array(nrm), "VEC3", 34962) }, indices: w.accessor(new Uint16Array(idx), "SCALAR", 34963), material: 0 }] });
  w.node({ mesh: 0 });
  return w.finish();
}

/** Starts the stand-in on a free port; returns its base URL. */
export function startMock(): string {
  const tasks = new Map<string, { polls: number; kind: string }>();
  let n = 0;
  const glb = cube();
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const json = (v: unknown, status = 200) => Response.json(v, { status });
      // model links are signed URLs, fetched without the key
      if (url.pathname === "/model.glb") return new Response(glb, { headers: { "content-type": "model/gltf-binary" } });
      if (!/^Bearer msy_/.test(req.headers.get("authorization") ?? "")) return json({ message: "Invalid API key" }, 401);
      if (url.pathname === "/openapi/v1/balance") return json({ balance: 1000 });
      const m = url.pathname.match(/^\/openapi\/(v2\/text-to-3d|v1\/image-to-3d|v1\/multi-image-to-3d)(?:\/([\w-]+))?$/);
      if (!m) return json({ message: "Not found" }, 404);
      if (req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!body) return json({ message: "Invalid JSON" }, 400);
        if (m[1].includes("text") && body.mode === "preview" && !body.prompt) return json({ message: "prompt is required" }, 400);
        if (m[1].includes("text") && body.mode === "refine" && !tasks.has(body.preview_task_id)) return json({ message: "preview task not found" }, 400);
        if (m[1] === "v1/image-to-3d" && !body.image_url) return json({ message: "image_url is required" }, 400);
        const id = `mock-${++n}`;
        tasks.set(id, { polls: 0, kind: m[1] });
        return json({ result: id }, 202);
      }
      const t = m[2] && tasks.get(m[2]);
      if (!t) return json({ message: "Task not found" }, 404);
      t.polls++;
      const done = t.polls >= 3;
      return json({
        id: m[2], status: done ? "SUCCEEDED" : t.polls === 1 ? "PENDING" : "IN_PROGRESS", progress: done ? 100 : 50,
        model_urls: done ? { glb: `${url.origin}/model.glb` } : {}, thumbnail_url: "", task_error: { message: "" },
      });
    },
  });
  server.unref(); // the command ends when its work does
  return `http://127.0.0.1:${server.port}`;
}
