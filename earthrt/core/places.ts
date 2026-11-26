// The place manifest (SPEC § 5): its type, its check, and how one version of a topic is chosen.
import { Frame, haversine } from "./geo.ts";

export type PlaceKind = "city" | "site" | "interior";

export interface GlbContent { type: "glb"; uri: string; position?: [number, number, number]; rotation?: [number, number, number]; scale?: number | [number, number, number] }
export interface SceneContent {
  type: "scene";
  entry: string;
  source?: string;
  /** A GLB of the same thing that a host which does not run scene modules (the web in v1) draws instead. */
  fallback?: string;
}
export interface TilesContent { type: "tiles"; uri: string }
export type PlaceContent = GlbContent | SceneContent | TilesContent;

export interface PlaceManifest {
  format: "earthrt/place@1";
  id: string;
  title: string;
  summary?: string;
  kind: PlaceKind;
  topic?: string;
  anchor: { lat: number; lon: number; height?: number; heightRef?: "terrain" | "ellipsoid"; heading?: number };
  bounds: { radius: number } | { polygon: [number, number][] };
  visibleFrom?: number;
  replaces?: ("buildings" | "terrain")[];
  minDistance?: number;
  era?: { label: string; year?: number };
  content: PlaceContent[];
  start?: { position: [number, number, number]; target: [number, number, number] };
  license?: string;
  credits?: string[];
}

/** A place as the registry lists it (SPEC § 8). */
export interface PlaceRecord {
  /** `<owner>/<repo>/<id>` */
  id: string;
  repo: string;
  sha: string;
  manifest: PlaceManifest;
  /** Base URL of the place's files at its commit (the mirror). */
  files: string;
  author: string;
  likes: number;
  stars: number;
  topic: string;
  updated: string;
}

export const VISIBLE_FROM: Record<PlaceKind, number> = { city: 30_000, site: 3_000, interior: 300 };

const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const isNum = (v: unknown, lo = -Infinity, hi = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isRel = (p: unknown) => typeof p === "string" && p.length > 0 && p.length < 512 && !p.startsWith("/") && !p.includes("..") && !/^[a-z]+:/i.test(p) && !p.includes("\\");

/** Problems with a manifest (empty: it is valid). */
export function validatePlace(m: unknown): string[] {
  const e: string[] = [];
  const o = m as Partial<PlaceManifest> | null;
  if (!o || typeof o !== "object") return ["not an object"];
  if (o.format !== "earthrt/place@1") e.push(`format must be "earthrt/place@1"`);
  if (typeof o.id !== "string" || !ID.test(o.id)) e.push("id: 3-64 of a-z, 0-9 and -, starting with a letter or digit");
  if (typeof o.title !== "string" || !o.title.trim() || o.title.length > 120) e.push("title: 1-120 characters");
  if (o.summary !== undefined && (typeof o.summary !== "string" || o.summary.length > 300)) e.push("summary: at most 300 characters");
  if (!["city", "site", "interior"].includes(o.kind as string)) e.push(`kind: "city", "site" or "interior"`);
  if (o.topic !== undefined && (typeof o.topic !== "string" || !/^(city|site|interior):[a-z0-9-]{2,64}(@[a-z0-9-]{1,32})?$/.test(o.topic))) e.push("topic: <kind>:<name>[@<era>], lower case");
  const a = o.anchor;
  if (!a || !isNum(a.lat, -90, 90) || !isNum(a.lon, -180, 180)) e.push("anchor: lat -90..90, lon -180..180");
  else {
    if (a.height !== undefined && !isNum(a.height, -12000, 100000)) e.push("anchor.height: m");
    if (a.heightRef !== undefined && a.heightRef !== "terrain" && a.heightRef !== "ellipsoid") e.push(`anchor.heightRef: "terrain" or "ellipsoid"`);
    if (a.heading !== undefined && !isNum(a.heading, -360, 360)) e.push("anchor.heading: degrees");
  }
  const b = o.bounds as { radius?: number; polygon?: [number, number][] } | undefined;
  if (!b || (b.radius === undefined && b.polygon === undefined)) e.push("bounds: { radius } or { polygon }");
  else if (b.radius !== undefined && !isNum(b.radius, 0.5, 200_000)) e.push("bounds.radius: 0.5 m to 200 km");
  else if (b.polygon !== undefined && (!Array.isArray(b.polygon) || b.polygon.length < 3 || b.polygon.length > 4096 || !b.polygon.every((p) => Array.isArray(p) && isNum(p[0], -90, 90) && isNum(p[1], -180, 180)))) e.push("bounds.polygon: 3-4096 [lat, lon] points");
  if (o.visibleFrom !== undefined && !isNum(o.visibleFrom, 1, 2_000_000)) e.push("visibleFrom: m");
  if (o.replaces !== undefined && (!Array.isArray(o.replaces) || !o.replaces.every((r) => r === "buildings" || r === "terrain"))) e.push(`replaces: ["buildings" | "terrain"]`);
  if (o.minDistance !== undefined && !isNum(o.minDistance, 0, 10_000)) e.push("minDistance: m");
  if (!Array.isArray(o.content) || o.content.length === 0 || o.content.length > 256) e.push("content: 1-256 entries");
  else o.content.forEach((c, i) => {
    const t = (c as PlaceContent)?.type;
    if (t === "glb") {
      const g = c as GlbContent;
      if (!isRel(g.uri) || !/\.glb$/i.test(g.uri)) e.push(`content[${i}].uri: a relative path to a .glb`);
      if (g.position !== undefined && !(Array.isArray(g.position) && g.position.length === 3 && g.position.every((v) => isNum(v)))) e.push(`content[${i}].position: [x, y, z]`);
      if (g.rotation !== undefined && !(Array.isArray(g.rotation) && g.rotation.length === 3 && g.rotation.every((v) => isNum(v)))) e.push(`content[${i}].rotation: [x, y, z] degrees`);
      if (g.scale !== undefined && !(isNum(g.scale, 1e-6) || (Array.isArray(g.scale) && g.scale.length === 3 && g.scale.every((v) => isNum(v, 1e-6))))) e.push(`content[${i}].scale: a number or [x, y, z]`);
    } else if (t === "scene") {
      const s = c as SceneContent;
      if (!isRel(s.entry) || !/\.(c?js)$/i.test(s.entry)) e.push(`content[${i}].entry: a relative path to the built .js`);
      if (s.source !== undefined && !isRel(s.source)) e.push(`content[${i}].source: a relative path`);
      if (s.fallback !== undefined && (!isRel(s.fallback) || !/\.glb$/i.test(s.fallback))) e.push(`content[${i}].fallback: a relative path to a .glb`);
    } else if (t === "tiles") {
      if (!isRel((c as TilesContent).uri)) e.push(`content[${i}].uri: a relative path to tileset.json`);
    } else e.push(`content[${i}].type: "glb", "scene" or "tiles"`);
  });
  if (o.start !== undefined && !(Array.isArray(o.start.position) && Array.isArray(o.start.target))) e.push("start: { position, target }");
  if (o.credits !== undefined && (!Array.isArray(o.credits) || o.credits.some((c) => typeof c !== "string"))) e.push("credits: strings");
  return e;
}

export const topicOf = (m: PlaceManifest) => m.topic ?? `${m.kind}:${m.id}`;
/** The topic without its era: the group a user switches between (`city:kyoto@meiji` → `city:kyoto`). */
export const topicBase = (t: string) => t.split("@")[0];

/** The rank a version gets in its topic: likes count double a star (a like is EarthRT's own). */
export const score = (p: Pick<PlaceRecord, "likes" | "stars">) => p.likes * 2 + p.stars;

/**
 * Which version of each topic shows: the user's choice where they made one, else the best ranked. Eras are topics of
 * their own (`city:kyoto@meiji`), offered beside the base.
 */
export function chooseVersions(places: PlaceRecord[], choice: Record<string, string> = {}): Map<string, PlaceRecord> {
  const byTopic = new Map<string, PlaceRecord[]>();
  for (const p of places) {
    const base = topicBase(p.topic);
    (byTopic.get(base) ?? byTopic.set(base, []).get(base)!).push(p);
  }
  const out = new Map<string, PlaceRecord>();
  for (const [topic, list] of byTopic) {
    const chosen = choice[topic] && list.find((p) => p.id === choice[topic]);
    out.set(topic, chosen || [...list].sort((a, b) => score(b) - score(a) || a.updated.localeCompare(b.updated))[0]);
  }
  return out;
}

/** The place's own frame (SPEC § 1) with its anchor at `groundHeight` (the terrain there, for heightRef "terrain"). */
export function placeFrame(m: PlaceManifest, groundHeight = 0): Frame {
  const a = m.anchor;
  const h = (a.height ?? 0) + (a.heightRef === "ellipsoid" ? 0 : groundHeight);
  return new Frame(a.lat, a.lon, h, a.heading ?? 0);
}

/** Radius of a place's bounds, m (a polygon's: from the anchor to its furthest point). */
export function placeRadius(m: PlaceManifest): number {
  const b = m.bounds as { radius?: number; polygon?: [number, number][] };
  if (b.radius !== undefined) return b.radius;
  return Math.max(...b.polygon!.map(([la, lo]) => haversine(m.anchor.lat, m.anchor.lon, la, lo)));
}

/** A lon/lat box around a place's bounds. */
export function placeBox(m: PlaceManifest) {
  const r = placeRadius(m);
  const dLat = (r / 111_320) * 1.01, dLon = dLat / Math.max(0.01, Math.cos((m.anchor.lat * Math.PI) / 180));
  return { west: m.anchor.lon - dLon, south: m.anchor.lat - dLat, east: m.anchor.lon + dLon, north: m.anchor.lat + dLat };
}
