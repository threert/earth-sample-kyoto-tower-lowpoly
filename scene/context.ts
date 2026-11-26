// What EarthRT hands a place's scene module (SPEC § 5, `scene` content). Type only: nothing here is bundled.
import type * as Three from "@threert/scene";

export interface PlaceContext {
  /** `@threert/scene`, the same module the scene imports (the loader passes it to the bundle's `require`). */
  THREE: typeof Three;
  /** This place's manifest (earthrt.json). */
  place: { id: string; title: string; kind: "city" | "site" | "interior"; anchor: { lat: number; lon: number; height?: number; heading?: number }; [k: string]: unknown };
  /** The place's frame: x east, y up, z south at the anchor, turned by its heading (metres). */
  frame: { lat: number; lon: number };
  /** A file of the place (a path relative to earthrt.json). Not in the preview: use `GLTFModel("assets/…")` for models. */
  readFile(path: string): ArrayBuffer;
  /** Local solar time at the place, hours 0..24: lamps can light at dusk. */
  time: number;
}

/** A place's scene module: `export default function build(ctx: PlaceContext): Object3D`. */
export type BuildPlace = (ctx: PlaceContext) => Three.Object3D | Promise<Three.Object3D>;
