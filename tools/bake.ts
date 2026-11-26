// bun run bake: the scene module (dist/scene.js, built first) as a GLB the web can draw: its meshes (instances
// expanded, merged by material), materials (PBR factors, textures, emission), and point / spot lights
// (KHR_lights_punctual). Written to the scene's `fallback` (default assets/models/scene.glb) and named there in
// earthrt.json. The client runs the scene itself and does not draw the fallback.
//
//   bun run bake [--out assets/models/scene.glb] [--no-build]
//
// Emission: ThreeRT's emissive is in nits, and so is a GLB's emissiveFactor × KHR_materials_emissive_strength when
// ThreeRT draws it (EarthRT's convention for places too: the web scales it by its exposure). The nits are also kept in
// the material's extras (`emissiveNits`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validatePlace, type SceneContent } from "../earthrt/core/places.ts";
import { GlbWriter } from "./lib/glb.ts";
import { loadThree, readManifest, root, runScene, type ThreeModule } from "./lib/scene.ts";
import { writeManifest } from "./lib/json.ts";
import { buildScene } from "./build.ts";

/** glTF emissive strength per nit (ThreeRT reads the strength as nits). */
const NITS_PER_UNIT = 1;

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

export async function bake(o: { out?: string; build?: boolean; quiet?: boolean } = {}): Promise<{ out: string; triangles: number; bytes: number; warnings: string[] }> {
  const m = readManifest();
  const i = m.content.findIndex((c) => c.type === "scene");
  if (i < 0) throw new Error("earthrt.json has no scene content: nothing to bake");
  const sc = m.content[i] as SceneContent;
  if (o.build !== false) await buildScene({ quiet: true });
  const THREE = await loadThree();
  const obj = await runScene(join(root, sc.entry), m, THREE);
  const warnings: string[] = [];
  const out = o.out ?? sc.fallback ?? "assets/models/scene.glb";
  const glb = toGlb(obj, THREE, warnings);
  mkdirSync(dirname(join(root, out)), { recursive: true });
  writeFileSync(join(root, out), glb.bytes);
  if (sc.fallback !== out) {
    sc.fallback = out;
    const problems = validatePlace(m);
    if (problems.length) throw new Error(`earthrt.json would not be valid: ${problems.join("; ")}`);
    writeManifest(root, m);
  }
  if (!o.quiet) {
    for (const w of warnings) console.warn(`! ${w}`);
    console.log(`✓ ${out}: ${glb.triangles} triangles, ${glb.materials} materials, ${glb.lights} lights, ${(glb.bytes.byteLength / 1024).toFixed(0)} KiB`);
  }
  return { out, triangles: glb.triangles, bytes: glb.bytes.byteLength, warnings };
}

type M4 = number[];

function xformPoint(e: M4, x: number, y: number, z: number): [number, number, number] {
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
}

/** The inverse transpose of the upper 3x3 (for normals), column-major 3x3. */
function normalMatrix(e: M4): number[] {
  const a = e[0], b = e[4], c = e[8], d = e[1], f = e[5], g = e[9], h = e[2], i = e[6], k = e[10];
  const A = f * k - g * i, B = -(d * k - g * h), C = d * i - f * h;
  const det = a * A + b * B + c * C || 1;
  // inverse rows = cofactors transposed / det; the transpose of the inverse = cofactor matrix / det
  return [
    A / det, B / det, C / det,
    -(b * k - c * i) / det, (a * k - c * h) / det, -(a * i - b * h) / det,
    (b * g - c * f) / det, -(a * g - c * d) / det, (a * f - b * d) / det,
  ];
}

function mulM4(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

interface Batch {
  material: ThreeModule;
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
  hasUv: boolean;
}

export function toGlb(obj: ThreeModule, THREE: ThreeModule, warnings: string[]) {
  obj.updateMatrixWorld?.();
  const batches = new Map<string, Batch>();
  const lights: { type: "point" | "spot"; color: number[]; intensity: number; range?: number; pos: number[]; dir?: number[]; angle?: number; penumbra?: number }[] = [];
  const warned = new Set<string>();
  const warn = (s: string) => {
    if (!warned.has(s)) {
      warned.add(s);
      warnings.push(s);
    }
  };

  const addGeometry = (geo: ThreeModule, materials: ThreeModule[], e: M4) => {
    const nm = normalMatrix(e);
    const flip = (e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2])) < 0;
    const groups: { start: number; count: number; materialIndex: number }[] = geo.groups?.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = materials[grp.materialIndex ?? 0] ?? materials[0];
      let g = geo;
      if (mat.flatShading) {
        g = geo.toNonIndexed();
        g.computeVertexNormals?.();
      }
      const P = g.attributes.position?.array as ArrayLike<number> | undefined;
      if (!P || P.length === 0) continue;
      if (!g.attributes.normal) g.computeVertexNormals?.();
      const N = g.attributes.normal?.array as ArrayLike<number> | undefined;
      const U = g.attributes.uv?.array as ArrayLike<number> | undefined;
      // ThreeRT keeps the index as a Uint32Array (empty: not indexed); three.js as an attribute
      const rawIndex = g.index as ArrayLike<number> & { array?: ArrayLike<number> } | null | undefined;
      const indexArr = rawIndex ? (rawIndex.array ?? rawIndex) : undefined;
      const I = indexArr && indexArr.length ? indexArr : undefined;
      const total = I ? I.length : P.length / 3;
      const start = mat.flatShading ? 0 : grp.start, end = Math.min(total, mat.flatShading ? total : grp.start + grp.count);
      const key = mat.uuid as string;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { material: mat, pos: [], nrm: [], uv: [], idx: [], hasUv: false }));
      if (U) b.hasUv = true;
      // copy the referenced vertices once
      const remap = new Map<number, number>();
      const vtx = (v: number) => {
        let r = remap.get(v);
        if (r !== undefined) return r;
        r = b!.pos.length / 3;
        remap.set(v, r);
        const p = xformPoint(e, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        b!.pos.push(p[0], p[1], p[2]);
        if (N) {
          const x = N[v * 3], y = N[v * 3 + 1], z = N[v * 3 + 2];
          let nx = nm[0] * x + nm[3] * y + nm[6] * z, ny = nm[1] * x + nm[4] * y + nm[7] * z, nz = nm[2] * x + nm[5] * y + nm[8] * z;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l; ny /= l; nz /= l;
          b!.nrm.push(nx, ny, nz);
        } else b!.nrm.push(0, 1, 0);
        if (U) b!.uv.push(U[v * 2], U[v * 2 + 1]);
        else b!.uv.push(0, 0);
        return r;
      };
      for (let t = start; t + 3 <= end; t += 3) {
        const a = I ? I[t] : t, c = I ? I[t + 1] : t + 1, d = I ? I[t + 2] : t + 2;
        if (flip) b.idx.push(vtx(a), vtx(d), vtx(c));
        else b.idx.push(vtx(a), vtx(c), vtx(d));
      }
    }
  };

  obj.traverse((o: ThreeModule) => {
    if (o.visible === false) return;
    const e: M4 = o.matrixWorld.elements;
    if (o.isInstancedMesh || o.type === "InstancedMesh") {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!o.geometry?.attributes) {
        warn(`${o.name || o.id}: a procedural instanced mesh is not baked`);
        return;
      }
      const im = o.instanceMatrix.array as ArrayLike<number>;
      for (let k = 0; k < o.count; k++) {
        const local = Array.from({ length: 16 }, (_, j) => im[k * 16 + j]);
        addGeometry(o.geometry, mats, mulM4(e, local));
      }
    } else if (o.isMesh || o.type === "Mesh") {
      addGeometry(o.geometry, Array.isArray(o.material) ? o.material : [o.material], e);
    } else if (o.type === "GLTFModel") {
      warn(`${o.uri}: a GLTFModel inside the scene is not baked; list it in earthrt.json as glb content instead (both hosts draw those)`);
    } else if (o.isPointLight || o.type === "PointLight" || o.isSpotLight || o.type === "SpotLight") {
      const p = [e[12], e[13], e[14]];
      const col = [o.color.r, o.color.g, o.color.b];
      if (o.isSpotLight || o.type === "SpotLight") {
        o.target?.updateMatrixWorld?.();
        const t = o.target ? [o.target.matrixWorld.elements[12], o.target.matrixWorld.elements[13], o.target.matrixWorld.elements[14]] : [p[0], p[1] - 1, p[2]];
        const d = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
        lights.push({ type: "spot", color: col, intensity: o.intensity, range: o.distance || undefined, pos: p, dir: d, angle: o.angle, penumbra: o.penumbra });
      } else lights.push({ type: "point", color: col, intensity: o.intensity, range: o.distance || undefined, pos: p });
    } else if (o.isLight || /Light$/.test(o.type ?? "")) {
      warn(`${o.type} is not baked (the sun and the sky are EarthRT's; area lights have no glTF form)`);
    } else if (o.type && !["Object3D", "Group", "Scene", "PerspectiveCamera"].includes(o.type)) {
      warn(`${o.type} is not baked`);
    }
  });

  const w = new GlbWriter();
  const texCache = new Map<string, number>();
  const texture = (t: ThreeModule): number | null => {
    if (!t) return null;
    if (texCache.has(t.uuid)) return texCache.get(t.uuid)!;
    let bytes: Uint8Array | null = null, mime = "image/png";
    if (t.pixels && t.width) bytes = THREE.encodePNG(t.width, t.height, t.pixels);
    else if (t.data) bytes = t.data;
    else if (typeof t.uri === "string" && existsSync(join(root, t.uri))) {
      bytes = new Uint8Array(readFileSync(join(root, t.uri)));
      mime = /\.jpe?g$/i.test(t.uri) ? "image/jpeg" : /\.webp$/i.test(t.uri) ? "image/webp" : "image/png";
    }
    if (!bytes) {
      warn(`texture ${t.uri} could not be read: left out`);
      return null;
    }
    const img = w.image(bytes, mime);
    w.json.samplers ??= [];
    const wrap = t.wrap === "clamp" ? 33071 : 10497;
    (w.json.samplers as unknown[]).push({ magFilter: 9729, minFilter: 9987, wrapS: wrap, wrapT: wrap });
    w.json.textures ??= [];
    w.json.textures.push({ source: img, sampler: (w.json.samplers as unknown[]).length - 1 });
    const i = w.json.textures.length - 1;
    texCache.set(t.uuid, i);
    return i;
  };
  const texInfo = (t: ThreeModule) => {
    const i = texture(t);
    if (i === null) return undefined;
    const info: Record<string, unknown> = { index: i };
    const rep = t.repeat ?? [1, 1], off = t.offset ?? [0, 0];
    if (rep[0] !== 1 || rep[1] !== 1 || off[0] !== 0 || off[1] !== 0) {
      w.use("KHR_texture_transform");
      info.extensions = { KHR_texture_transform: { offset: off, scale: rep } };
    }
    return info;
  };

  let triangles = 0;
  const mesh = { primitives: [] as unknown[] };
  for (const b of batches.values()) {
    if (!b.idx.length) continue;
    const mat = b.material;
    const m: Record<string, unknown> = { name: mat.name || undefined };
    const pbr: Record<string, unknown> = {
      baseColorFactor: [mat.color.r, mat.color.g, mat.color.b, mat.opacity ?? 1],
      metallicFactor: mat.metalness ?? 0,
      roughnessFactor: mat.roughness ?? 1,
    };
    if (mat.map) pbr.baseColorTexture = texInfo(mat.map);
    if (mat.roughnessMap || mat.metalnessMap) warn("roughness / metalness maps are not baked (glTF packs them in one texture): the factors are");
    m.pbrMetallicRoughness = pbr;
    if (mat.normalMap) {
      const n = texInfo(mat.normalMap);
      if (n) m.normalTexture = { ...n, scale: mat.normalScale?.[0] ?? 1 };
    }
    const nits = [mat.emissive.r, mat.emissive.g, mat.emissive.b].map((c: number) => c * (mat.emissiveIntensity ?? 1));
    const peak = Math.max(...nits);
    if (peak > 0 || mat.emissiveMap) {
      const s = Math.max(peak, 1e-6);
      m.emissiveFactor = nits.map((c) => c / s);
      const strength = peak / NITS_PER_UNIT;
      if (strength !== 1) {
        w.use("KHR_materials_emissive_strength");
        m.extensions = { KHR_materials_emissive_strength: { emissiveStrength: strength } };
      }
      m.extras = { emissiveNits: peak };
      if (mat.emissiveMap) m.emissiveTexture = texInfo(mat.emissiveMap);
    }
    if (mat.doubleSided || mat.side === "double" || mat.side === 2) m.doubleSided = true;
    if (mat.transparent) m.alphaMode = "BLEND";
    else if (mat.alphaTest > 0) {
      m.alphaMode = "MASK";
      m.alphaCutoff = mat.alphaTest;
    }
    if (typeof mat.transmission === "number" && mat.transmission > 0) {
      w.use("KHR_materials_transmission");
      m.extensions = { ...(m.extensions as object), KHR_materials_transmission: { transmissionFactor: mat.transmission } };
    }
    if (typeof mat.ior === "number" && mat.ior !== 1.5 && mat.type === "physical") {
      w.use("KHR_materials_ior");
      m.extensions = { ...(m.extensions as object), KHR_materials_ior: { ior: mat.ior } };
    }
    if (mat.shader) warn(`material ${mat.name || mat.uuid}: its shader (a material function) is not baked: the base factors are`);
    w.json.materials!.push(m);
    const vcount = b.pos.length / 3;
    const attributes: Record<string, number> = {
      POSITION: w.accessor(new Float32Array(b.pos), "VEC3", 34962, true),
      NORMAL: w.accessor(new Float32Array(b.nrm), "VEC3", 34962),
    };
    if (b.hasUv) attributes.TEXCOORD_0 = w.accessor(new Float32Array(b.uv), "VEC2", 34962);
    const indices = w.accessor(vcount < 65536 ? new Uint16Array(b.idx) : new Uint32Array(b.idx), "SCALAR", 34963);
    mesh.primitives.push({ attributes, indices, material: w.json.materials!.length - 1, mode: 4 });
    triangles += b.idx.length / 3;
  }
  if (mesh.primitives.length) {
    w.json.meshes!.push(mesh as never);
    w.node({ mesh: 0, name: "scene" } as never);
  }
  if (lights.length) {
    w.use("KHR_lights_punctual");
    const defs = lights.map((l) => ({
      type: l.type, color: l.color, intensity: l.intensity, ...(l.range ? { range: l.range } : {}),
      ...(l.type === "spot" ? { spot: { outerConeAngle: l.angle ?? Math.PI / 4, innerConeAngle: (l.angle ?? Math.PI / 4) * (1 - (l.penumbra ?? 0)) } } : {}),
    }));
    w.json.extensions = { KHR_lights_punctual: { lights: defs } };
    lights.forEach((l, i) => {
      const node: Record<string, unknown> = { name: `light-${i}`, translation: l.pos, extensions: { KHR_lights_punctual: { light: i } } };
      if (l.dir) node.rotation = lookRotation(l.dir);
      w.node(node as never);
    });
  }
  return { bytes: w.finish(), triangles, materials: w.json.materials?.length ?? 0, lights: lights.length };
}

/** A quaternion turning −Z to `d`. */
function lookRotation(d: number[]): number[] {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const v = [d[0] / l, d[1] / l, d[2] / l];
  const from = [0, 0, -1];
  const dot = from[0] * v[0] + from[1] * v[1] + from[2] * v[2];
  if (dot < -0.999999) return [0, 1, 0, 0];
  const c = [from[1] * v[2] - from[2] * v[1], from[2] * v[0] - from[0] * v[2], from[0] * v[1] - from[1] * v[0]];
  const q = [c[0], c[1], c[2], 1 + dot];
  const n = Math.hypot(...q);
  return q.map((x) => x / n);
}

if (import.meta.main) {
  bake({ out: flag("--out"), build: !args.includes("--no-build") }).catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
