// The model this place ships: `bun tools/models.ts` after changing scene/lowpoly.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { toGlb } from "./bake.ts";
import { loadThree, root } from "./lib/scene.ts";

const THREE = await loadThree();
const built = await Bun.build({ entrypoints: [join(root, "scene/lowpoly.ts")], format: "cjs", target: "browser", external: ["@threert/scene"] });
const mod = { exports: {} as Record<string, unknown> };
new Function("module", "exports", "require", await built.outputs[0].text())(mod, mod.exports, () => THREE);
const warnings: string[] = [];
const glb = toGlb((mod.exports.lowpolyTower as () => unknown)(), THREE, warnings);
writeFileSync(join(root, "assets/models/kyoto-tower.glb"), glb.bytes);
for (const w of warnings) console.warn(`! ${w}`);
console.log(`✓ assets/models/kyoto-tower.glb: ${glb.triangles} triangles`);
