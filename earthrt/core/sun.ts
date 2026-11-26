// The sun's direction in ECEF for a moment (NOAA's low-precision formulas: about 0.01° from 1950 to 2050).
import type { V3 } from "./geo.ts";

/** Unit vector toward the sun, ECEF, at a UTC time (ms since 1970). */
export function sunDirection(utcMs: number): V3 {
  const jd = utcMs / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (((357.528 + 0.9856003 * n) % 360) * Math.PI) / 180;
  const lambda = ((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;
  const eps = ((23.439 - 0.0000004 * n) * Math.PI) / 180;
  // equatorial (inertial) direction
  const x = Math.cos(lambda), y = Math.cos(eps) * Math.sin(lambda), z = Math.sin(eps) * Math.sin(lambda);
  // Greenwich mean sidereal time turns it into the Earth's frame
  const gmst = (((280.46061837 + 360.98564736629 * n) % 360) * Math.PI) / 180;
  const c = Math.cos(gmst), s = Math.sin(gmst);
  return [c * x + s * y, -s * x + c * y, z];
}

/** The UTC time at which the local solar time at `lon` is `hours` (0..24) on the date of `utcMs`. */
export function solarTime(utcMs: number, lon: number, hours: number): number {
  const day = Math.floor(utcMs / 86400000) * 86400000;
  return day + (hours - lon / 15) * 3600000;
}
