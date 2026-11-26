// This place has no scene module: its content is one GLB (assets/models/kyoto-tower.glb, made by tools/models.ts
// from scene/lowpoly.ts). The preview imports this file, so it stays; add a `scene` entry to earthrt.json to use it.
import { Group, type Object3D } from "@threert/scene";
import type { PlaceContext } from "./context.ts";

export default function build(_ctx: PlaceContext): Object3D {
  return new Group();
}
