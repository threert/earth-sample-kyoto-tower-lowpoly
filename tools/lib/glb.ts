// GLB files: reading what one holds (check, meshy sizing) and writing one (bake).
// Binary glTF 2.0: "glTF", version 2, length; a JSON chunk; a BIN chunk.

// ---------------------------------------------------------------------------------------------------------------------
// Reading

export interface GltfJson {
  asset?: { generator?: string; version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extensions?: Record<string, unknown> }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
  buffers?: { byteLength: number; uri?: string }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  textures?: { source?: number; sampler?: number; extensions?: Record<string, { source?: number }> }[];
  materials?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [k: string]: unknown;
}

export interface Glb {
  json: GltfJson;
  bin: Uint8Array;
}

export function readGlb(bytes: Uint8Array): Glb {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB (no glTF magic)");
  if (dv.getUint32(4, true) !== 2) throw new Error(`glTF version ${dv.getUint32(4, true)}, not 2`);
  let off = 12;
  let json: GltfJson | null = null;
  let bin = new Uint8Array(0);
  while (off + 8 <= bytes.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

/** A 4x4 column-major matrix product a·b. */
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(n: NonNullable<GltfJson["nodes"]>[number]): number[] {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export interface GlbStats {
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  /** Each image's size in pixels (PNG / JPEG / WebP headers; null where it could not be read). */
  images: { mime: string; width: number | null; height: number | null; bytes: number }[];
  /** Bounds of every vertex in the file's scene, after node transforms (approximate: accessor min/max corners). */
  min: [number, number, number];
  max: [number, number, number];
  extensionsRequired: string[];
}

function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1], len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.subarray(12, 16));
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

export function glbStats(g: Glb): GlbStats {
  const j = g.json;
  let triangles = 0, vertices = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const visit = (ni: number, parent: number[]) => {
    const n = j.nodes![ni];
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of j.meshes![n.mesh].primitives) {
        const pos = j.accessors![p.attributes.POSITION];
        vertices += pos.count;
        const mode = p.mode ?? 4;
        const count = p.indices !== undefined ? j.accessors![p.indices].count : pos.count;
        if (mode === 4) triangles += Math.floor(count / 3);
        else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
        if (pos.min && pos.max) {
          for (let c = 0; c < 8; c++) {
            const v = [c & 1 ? pos.max[0] : pos.min[0], c & 2 ? pos.max[1] : pos.min[1], c & 4 ? pos.max[2] : pos.min[2]];
            for (let k = 0; k < 3; k++) {
              const w = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k];
              if (w < min[k]) min[k] = w;
              if (w > max[k]) max[k] = w;
            }
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = j.scenes?.[j.scene ?? 0];
  const roots = scene?.nodes ?? (j.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, I);
  const images = (j.images ?? []).map((im) => {
    if (im.bufferView === undefined) return { mime: im.mimeType ?? "external", width: null, height: null, bytes: 0 };
    const bv = j.bufferViews![im.bufferView];
    const b = g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const s = imageSize(b);
    return { mime: im.mimeType ?? "?", width: s?.width ?? null, height: s?.height ?? null, bytes: bv.byteLength };
  });
  return { triangles, vertices, meshes: j.meshes?.length ?? 0, materials: j.materials?.length ?? 0, images, min, max, extensionsRequired: j.extensionsRequired ?? [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing

export class GlbWriter {
  json: GltfJson = { asset: { version: "2.0", generator: "earth-place-template bake" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [], materials: [] };
  private chunks: Uint8Array[] = [];
  private length = 0;
  private used = new Set<string>();

  use(ext: string) {
    this.used.add(ext);
  }

  /** Appends bytes as a buffer view (4-byte aligned) and returns its index. */
  view(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    const v = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) };
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    this.json.bufferViews!.push(v);
    return this.json.bufferViews!.length - 1;
  }

  accessor(data: Float32Array | Uint32Array | Uint16Array, type: "SCALAR" | "VEC2" | "VEC3" | "VEC4", target?: number, minmax = false): number {
    const comp = data instanceof Float32Array ? 5126 : data instanceof Uint32Array ? 5125 : 5123;
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const bv = this.view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), target);
    const a: NonNullable<GltfJson["accessors"]>[number] = { bufferView: bv, componentType: comp, count: data.length / size, type };
    if (minmax) {
      const mn = new Array(size).fill(Infinity), mx = new Array(size).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        const k = i % size;
        if (data[i] < mn[k]) mn[k] = data[i];
        if (data[i] > mx[k]) mx[k] = data[i];
      }
      a.min = mn;
      a.max = mx;
    }
    this.json.accessors!.push(a);
    return this.json.accessors!.length - 1;
  }

  image(bytes: Uint8Array, mimeType: string): number {
    this.json.images ??= [];
    this.json.images.push({ bufferView: this.view(bytes), mimeType });
    return this.json.images.length - 1;
  }

  node(n: NonNullable<GltfJson["nodes"]>[number]): number {
    this.json.nodes!.push(n);
    const i = this.json.nodes!.length - 1;
    this.json.scenes![0].nodes!.push(i);
    return i;
  }

  finish(): Uint8Array {
    if (this.used.size) this.json.extensionsUsed = [...this.used];
    const bin = new Uint8Array(Math.ceil(this.length / 4) * 4);
    let o = 0;
    for (const c of this.chunks) {
      bin.set(c, o);
      o += c.byteLength;
    }
    this.json.buffers = [{ byteLength: bin.byteLength }];
    for (const k of Object.keys(this.json)) {
      const v = this.json[k];
      if (Array.isArray(v) && v.length === 0 && k !== "nodes") delete this.json[k];
    }
    let text = new TextEncoder().encode(JSON.stringify(this.json));
    const jpad = (4 - (text.byteLength % 4)) % 4;
    if (jpad) {
      const t = new Uint8Array(text.byteLength + jpad).fill(0x20);
      t.set(text);
      text = t;
    }
    const total = 12 + 8 + text.byteLength + 8 + bin.byteLength;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, text.byteLength, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(text, 20);
    const b = 20 + text.byteLength;
    dv.setUint32(b, bin.byteLength, true);
    dv.setUint32(b + 4, 0x004e4942, true);
    out.set(bin, b + 8);
    return out;
  }
}
