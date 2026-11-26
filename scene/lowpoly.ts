// Kyoto Tower, low-poly: an octagonal, flat-shaded take on the tower and its building, in pastel colours, made in
// code and baked to assets/models/kyoto-tower.glb (`bun tools/models.ts`). The place is that GLB alone: the web and
// the client show the same model. Metres, the tower's axis at the origin.
import { BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial, type Object3D } from "@threert/scene";

export function lowpolyTower(): Object3D {
  const g = new Group();
  g.name = "kyoto-tower-lowpoly";
  const flat = (color: number, roughness = 0.6, extra: Record<string, unknown> = {}) => new MeshStandardMaterial({ color, roughness, flatShading: true, ...extra });
  const wall = flat(0xf1e6d6), stripe = flat(0x8fb3c9, 0.4), tower = flat(0xfbf8f2, 0.45), deck = flat(0x3d5a73, 0.15), red = flat(0xe0533d, 0.5);
  const add = (o: Mesh, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  // the building: three stacked blocks with window stripes
  add(new Mesh(new BoxGeometry(64, 34, 44), wall), 0, 14, 0);
  for (let f = 0; f < 9; f++) {
    add(new Mesh(new BoxGeometry(64.4, 1.1, 44.4), stripe), 0, 6.5 + f * 2.85, 0);
  }
  add(new Mesh(new BoxGeometry(60, 1.2, 40), stripe), 0, 31.6, 0);
  // the tower: an eight-sided lathe, a faceted deck, a red tip
  const pts = [[7.4, 32], [5.2, 48], [4.0, 72], [3.8, 88], [8.6, 92], [8.6, 104], [5.4, 106.5], [2.6, 117], [0.6, 125]].map(([x, y]) => ({ x, y }));
  add(new Mesh(new LatheGeometry(pts, 8), tower), 0, 0, 0);
  add(new Mesh(new CylinderGeometry(8.75, 8.75, 7.4, 8, 1, true), deck), 0, 99, 0).rotation.y = Math.PI / 8;
  add(new Mesh(new CylinderGeometry(0.2, 0.6, 6, 8), red), 0, 128, 0);
  return g;
}
