// Geodesy on WGS84 and the floating local frame (SPEC § 1). Doubles throughout: what reaches the GPU is relative to
// the frame's origin, computed here.

export type V3 = [number, number, number];

export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Mean radius, m (for distances on the sphere). */
export const EARTH_RADIUS = 6371008.8;

const RAD = Math.PI / 180;
export const toRad = (d: number) => d * RAD;
export const toDeg = (r: number) => r / RAD;

/** ECEF of latitude, longitude (degrees) and height above the ellipsoid (m). */
export function geodeticToEcef(lat: number, lon: number, h = 0, out: V3 = [0, 0, 0]): V3 {
  const phi = lat * RAD, lam = lon * RAD;
  const s = Math.sin(phi), c = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  out[0] = (n + h) * c * Math.cos(lam);
  out[1] = (n + h) * c * Math.sin(lam);
  out[2] = (n * (1 - WGS84_E2) + h) * s;
  return out;
}

/** Latitude, longitude (degrees) and height (m) of an ECEF point (Bowring's method, two refinements: < 1 mm). */
export function ecefToGeodetic(x: number, y: number, z: number): { lat: number; lon: number; h: number } {
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  if (p < 1e-9) return { lat: z >= 0 ? 90 : -90, lon: 0, h: Math.abs(z) - WGS84_B };
  const ep2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B);
  let beta = Math.atan2(z * WGS84_A, p * WGS84_B);
  let phi = 0;
  for (let i = 0; i < 3; i++) {
    const sb = Math.sin(beta), cb = Math.cos(beta);
    phi = Math.atan2(z + ep2 * WGS84_B * sb * sb * sb, p - WGS84_E2 * WGS84_A * cb * cb * cb);
    beta = Math.atan2(WGS84_B * Math.sin(phi), WGS84_A * Math.cos(phi));
  }
  const s = Math.sin(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * s * s);
  const h = Math.abs(Math.cos(phi)) > 1e-6 ? p / Math.cos(phi) - n : Math.abs(z) / Math.abs(s) - n * (1 - WGS84_E2);
  return { lat: phi / RAD, lon: lon / RAD, h };
}

/** East, north and up unit vectors (ECEF axes) at a latitude and longitude. */
export function enu(lat: number, lon: number): { e: V3; n: V3; u: V3 } {
  const phi = lat * RAD, lam = lon * RAD;
  const sp = Math.sin(phi), cp = Math.cos(phi), sl = Math.sin(lam), cl = Math.cos(lam);
  return { e: [-sl, cl, 0], n: [-sp * cl, -sp * sl, cp], u: [cp * cl, cp * sl, sp] };
}

/** The ellipsoid's outward normal at an ECEF point (the geodetic up). */
export function upAt(p: V3): V3 {
  const g = ecefToGeodetic(p[0], p[1], p[2]);
  return enu(g.lat, g.lon).u;
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A rotation as a quaternion [x, y, z, w] (three.js order). */
export type Quat = [number, number, number, number];

/** Quaternion of a 3x3 rotation given by rows (r0, r1, r2): v' = [r0·v, r1·v, r2·v]. */
export function quatFromRows(r0: V3, r1: V3, r2: V3): Quat {
  const m00 = r0[0], m01 = r0[1], m02 = r0[2], m10 = r1[0], m11 = r1[1], m12 = r1[2], m20 = r2[0], m21 = r2[1], m22 = r2[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/**
 * East-up-south at a point on the ellipsoid (SPEC § 1): x = east, y = up, z = south. Maps ECEF offsets and directions
 * to the frame and back. The local frame of the view is one of these at the origin O; a place's frame is one at its
 * anchor, turned by its heading.
 */
export class Frame {
  readonly lat: number;
  readonly lon: number;
  readonly origin: V3;
  /** Rows of R: ECEF → frame. */
  readonly rx: V3;
  readonly ry: V3;
  readonly rz: V3;
  /** R as a quaternion (the rotation a tile in ECEF axes gets in this frame). */
  readonly quat: Quat;

  constructor(lat: number, lon: number, height = 0, headingDeg = 0) {
    this.lat = lat;
    this.lon = lon;
    this.origin = geodeticToEcef(lat, lon, height);
    const { e, n, u } = enu(lat, lon);
    // heading turns the frame about up: forward (−z) points heading° clockwise from north
    const h = headingDeg * RAD, ch = Math.cos(h), sh = Math.sin(h);
    const fwd: V3 = add(scale(n, ch), scale(e, sh));
    const right: V3 = add(scale(e, ch), scale(n, -sh));
    this.rx = right;
    this.ry = u;
    this.rz = scale(fwd, -1);
    this.quat = quatFromRows(this.rx, this.ry, this.rz);
  }

  /** An ECEF direction in the frame. */
  dir(d: V3, out: V3 = [0, 0, 0]): V3 {
    out[0] = dot(this.rx, d); out[1] = dot(this.ry, d); out[2] = dot(this.rz, d);
    return out;
  }

  /** An ECEF point in the frame. */
  point(p: V3, out: V3 = [0, 0, 0]): V3 {
    const dx = p[0] - this.origin[0], dy = p[1] - this.origin[1], dz = p[2] - this.origin[2];
    out[0] = this.rx[0] * dx + this.rx[1] * dy + this.rx[2] * dz;
    out[1] = this.ry[0] * dx + this.ry[1] * dy + this.ry[2] * dz;
    out[2] = this.rz[0] * dx + this.rz[1] * dy + this.rz[2] * dz;
    return out;
  }

  /** A frame direction in ECEF. */
  dirToEcef(v: V3): V3 {
    return [
      this.rx[0] * v[0] + this.ry[0] * v[1] + this.rz[0] * v[2],
      this.rx[1] * v[0] + this.ry[1] * v[1] + this.rz[1] * v[2],
      this.rx[2] * v[0] + this.ry[2] * v[1] + this.rz[2] * v[2],
    ];
  }

  /** A frame point in ECEF. */
  pointToEcef(v: V3): V3 {
    return add(this.origin, this.dirToEcef(v));
  }

  /** Rotation of another frame's axes into this one (for a place: R · R_place⁻¹... as a quaternion). */
  quatOf(other: Frame): Quat {
    // the other frame's axes, expressed in this frame, are the columns of the rotation other → this
    const cx = this.dir(other.rx), cy = this.dir(other.ry), cz = this.dir(other.rz);
    return quatFromRows([cx[0], cy[0], cz[0]], [cx[1], cy[1], cz[1]], [cx[2], cy[2], cz[2]]);
  }
}

/** Great-circle distance on the mean sphere, m. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = p2 - p1, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from 1 to 2, degrees clockwise from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `t` (0..1) of the way along the great circle from 1 to 2. */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, t: number): { lat: number; lon: number } {
  const a = toUnit(lat1, lon1), b = toUnit(lat2, lon2);
  const omega = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (omega < 1e-12) return { lat: lat1, lon: lon1 };
  const s = Math.sin(omega);
  const p = add(scale(a, Math.sin((1 - t) * omega) / s), scale(b, Math.sin(t * omega) / s));
  return { lat: toDeg(Math.atan2(p[2], Math.hypot(p[0], p[1]))), lon: toDeg(Math.atan2(p[1], p[0])) };
}

function toUnit(lat: number, lon: number): V3 {
  const p = lat * RAD, l = lon * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}
