// earthrt.json as a person writes it: two-space indents, short arrays and small objects on one line.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlaceManifest } from "../../earthrt/core/places.ts";

/** One line: `{ "a": 1, "b": [1, 2] }`. */
function inline(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  const e = Object.entries(v as object).filter(([, x]) => x !== undefined);
  return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }` : "{}";
}

export function pretty(v: unknown, indent = ""): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  const one = inline(v);
  const nested = Array.isArray(v) ? v.some((x) => x && typeof x === "object" && !Array.isArray(x)) : Object.values(v as object).some((x) => x && typeof x === "object" && !Array.isArray(x));
  if (one.length + indent.length <= 116 && (!nested || one.length + indent.length <= 100)) return one;
  const inner = indent + "  ";
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(",\n")}\n${indent}}`;
}

export function writeManifest(root: string, m: PlaceManifest) {
  writeFileSync(join(root, "earthrt.json"), pretty(m) + "\n");
}
