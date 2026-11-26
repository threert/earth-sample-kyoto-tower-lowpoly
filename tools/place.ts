// bun run place: where the place is and how far it reaches, written into earthrt.json.
//
//   bun run place                                   show the anchor, with map links
//   bun run place --at 35.00366,135.77512           the anchor from latitude, longitude
//   bun run place --at "https://www.google.com/maps/@35.0036,135.7751,19z"     a Google Maps link
//   bun run place --at "https://www.openstreetmap.org/#map=19/35.00366/135.77512"   an OpenStreetMap link
//   bun run place --at "https://earth.threert.dev/?at=35.0036,135.7751,300"     an EarthRT link
//     [--heading 90 | --face 35.0040,135.7760]      forward (−z) toward a compass bearing, or toward a point
//     [--radius 30] [--height 0] [--height-ref terrain|ellipsoid] [--visible-from 1500] [--enter-from 120]
//     [--id x] [--title T] [--summary S] [--kind city|site|interior] [--topic site:x] [--license L]
//     [--fit]                                       bounds = how far the models reach (+10 %)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { bearing } from "../earthrt/core/geo.ts";
import { placeRadius, validatePlace, type PlaceKind } from "../earthrt/core/places.ts";
import { readManifest, root } from "./lib/scene.ts";
import { writeManifest } from "./lib/json.ts";

/** Latitude and longitude from text: "lat,lon", or a Google Maps, OpenStreetMap, Apple Maps or EarthRT link. */
export function parseLocation(s: string): { lat: number; lon: number } | null {
  const t = decodeURIComponent(s.trim());
  const pair = (a: string, b: string) => {
    const lat = Number(a), lon = Number(b);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  };
  let m: RegExpMatchArray | null;
  // Google Maps: a pin's own place (!3d<lat>!4d<lon>) beats the view's centre (@lat,lon,zoom)
  if ((m = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/))) return pair(m[1], m[2]);
  if ((m = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$)/))) return pair(m[1], m[2]);
  // OpenStreetMap: a marker (mlat/mlon), else the view (#map=z/lat/lon)
  if ((m = t.match(/mlat=(-?\d+(?:\.\d+)?).*?mlon=(-?\d+(?:\.\d+)?)/))) return pair(m[1], m[2]);
  if ((m = t.match(/map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/))) return pair(m[1], m[2]);
  // EarthRT (?at=lat,lon,alt), Apple Maps (ll= / q=), Google (q= / query=)
  if ((m = t.match(/[?&#](?:at|ll|q|query|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/))) return pair(m[1], m[2]);
  // geo: URIs and plain "lat, lon"
  if ((m = t.match(/^(?:geo:)?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/))) return pair(m[1], m[2]);
  return null;
}

/** Map links for an anchor. */
export function links(lat: number, lon: number) {
  return {
    osm: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=19/${lat.toFixed(6)}/${lon.toFixed(6)}`,
    google: `https://www.google.com/maps/@${lat.toFixed(6)},${lon.toFixed(6)},19z/data=!3m1!1e3`,
    earthrt: `https://earth.threert.dev/?at=${lat.toFixed(6)},${lon.toFixed(6)},300`,
  };
}

if (import.meta.main) {
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
  try {
    const m = readManifest();
    const at = flag("--at");
    if (at) {
      const p = parseLocation(at);
      if (!p) throw new Error(`--at: no latitude and longitude in ${at}`);
      m.anchor = { ...m.anchor, lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) };
    }
    const face = flag("--face");
    if (face) {
      const p = parseLocation(face);
      if (!p) throw new Error(`--face: no latitude and longitude in ${face}`);
      m.anchor.heading = +bearing(m.anchor.lat, m.anchor.lon, p.lat, p.lon).toFixed(2);
    }
    const heading = num("--heading");
    if (heading !== undefined) m.anchor.heading = heading;
    const height = num("--height");
    if (height !== undefined) m.anchor.height = height;
    const ref = flag("--height-ref");
    if (ref) m.anchor.heightRef = ref as "terrain" | "ellipsoid";
    const radius = num("--radius");
    if (radius !== undefined) m.bounds = { radius };
    const vf = num("--visible-from");
    if (vf !== undefined) m.visibleFrom = vf;
    const ef = num("--enter-from");
    if (ef !== undefined) m.enterFrom = ef;
    for (const k of ["id", "title", "summary", "topic", "license"] as const) {
      const v = flag(`--${k}`);
      if (v !== undefined) (m as unknown as Record<string, string>)[k] = v;
    }
    const kind = flag("--kind");
    if (kind) m.kind = kind as PlaceKind;
    if (args.includes("--fit")) {
      const { check, placedReach } = await import("./check.ts");
      const r = await check({ scene: false });
      let reach = 0;
      for (const mo of r.models) {
        const c = m.content.find((x) => x.type === "glb" && x.uri === mo.uri);
        reach = Math.max(reach, placedReach(mo.stats, c && c.type === "glb" ? c : {}).reach);
      }
      if (reach > 0) m.bounds = { radius: Math.ceil(reach * 1.1 * 10) / 10 };
    }
    const problems = validatePlace(m);
    if (problems.length) throw new Error(problems.join("; "));
    const changed = args.length > 0;
    if (changed) writeManifest(root, m);
    const l = links(m.anchor.lat, m.anchor.lon);
    console.log(`${changed ? "✓ earthrt.json: " : ""}${m.id} (${m.kind}) at ${m.anchor.lat}, ${m.anchor.lon}, heading ${m.anchor.heading ?? 0}°, bounds ${placeRadius(m).toFixed(1)} m`);
    console.log(`  OpenStreetMap  ${l.osm}\n  Google Maps    ${l.google}\n  EarthRT        ${l.earthrt}`);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
