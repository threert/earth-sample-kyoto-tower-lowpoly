// Optional, for those with ThreeRT installed: the place alone, path-traced, as `threert dev` shows it (with
// threert.config.json). It reads earthrt.json, puts every `glb` where the manifest says, runs the scene module
// (scene/main.ts) in the place's frame, and lights it with the real sun over the anchor at a local solar time. The
// place on the globe is the EarthRT app's dev mode (`bun run dev --app`) or the web's (`bun run dev`).
//
// Keys: T later in the day (+1 h), Y earlier, N night / noon, G the ground on / off, F the fallback GLB instead of
// the scene (what the web shows).
import * as THREE from "@threert/scene";
import { DirectionalLight, GLTFModel, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SkyAtmosphere, type Object3D } from "@threert/scene";
import { defineGame, type FrameContext } from "@threert/gameplay";
import { Frame } from "./earthrt/core/geo.ts";
import { validatePlace, type PlaceManifest } from "./earthrt/core/places.ts";
import { solarTime, sunDirection } from "./earthrt/core/sun.ts";
import manifestJson from "./earthrt.json";
import main from "./scene/main.ts";
import type { BuildPlace } from "./scene/context.ts";

const build = main as BuildPlace;

const place = manifestJson as unknown as PlaceManifest;
const problems = validatePlace(place);
for (const p of problems) console.error(`earthrt.json: ${p}`);

interface State {
  hour: number;
  ground: boolean;
  fallback: boolean;
}

const frameOf = new Frame(place.anchor.lat, place.anchor.lon, 0, place.anchor.heading ?? 0);

/** The sun's direction in the place's frame at a local solar hour today. */
function sunIn(hour: number): [number, number, number] {
  const d = sunDirection(solarTime(Date.now(), place.anchor.lon, hour));
  return frameOf.dir(d);
}

const DEG = Math.PI / 180;
function placeGlb(uri: string, c: { position?: number[]; rotation?: number[]; scale?: number | number[] }): Object3D {
  const m = new GLTFModel(uri);
  if (c.position) m.position.set(c.position[0], c.position[1], c.position[2]);
  if (c.rotation) m.rotation.set(c.rotation[0] * DEG, c.rotation[1] * DEG, c.rotation[2] * DEG);
  if (typeof c.scale === "number") m.scale.setScalar(c.scale);
  else if (Array.isArray(c.scale)) m.scale.set(c.scale[0], c.scale[1], c.scale[2]);
  return m;
}

function frame(f: FrameContext<State>) {
  const sun = f.object("sun") as DirectionalLight;
  const s = sunIn(f.state.hour);
  sun.position.set(s[0] * 100, s[1] * 100, s[2] * 100);
  const ground = f.object("ground");
  if (ground) ground.visible = f.state.ground;
  const scene = f.object("place-scene");
  const fallback = f.object("place-fallback");
  if (scene) scene.visible = !f.state.fallback || !fallback;
  if (fallback) fallback.visible = f.state.fallback;
}

export default defineGame<State>({
  state: { hour: 15, ground: true, fallback: false },

  setup() {
    const scene = new Scene();
    const sun = new DirectionalLight(0xffffff, 80000);
    sun.id = "sun";
    scene.add(sun);
    scene.environment = new SkyAtmosphere({ sun, dynamic: true, glow: 0x6b7fb3, glowIntensity: 0.02 });

    // Stand-in for the trunk's ground (EarthRT draws the real terrain around the place).
    const ground = new Mesh(new PlaneGeometry(2000, 2000), new MeshStandardMaterial({ color: 0x5f5a50, roughness: 0.9 }));
    ground.id = "ground";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    scene.add(ground);

    const root = new Group();
    root.id = "place";
    scene.add(root);
    place.content.forEach((c, i) => {
      if (c.type === "glb") {
        const m = placeGlb(c.uri, c);
        m.id = `place-glb-${i}`;
        root.add(m);
      } else if (c.type === "scene") {
        const ctx = {
          THREE, place: place as never, frame: frameOf,
          readFile(): ArrayBuffer {
            throw new Error("readFile is not in the preview: load models with GLTFModel(\"assets/…\")");
          },
          time: 15,
        };
        const out = build(ctx);
        if (out instanceof Promise) {
          out.then((o) => {
            o.id = "place-scene";
            root.add(o);
          }, (e) => console.error(`scene/main.ts: ${e}`));
        } else {
          out.id = "place-scene";
          root.add(out);
        }
        if (c.fallback) {
          const fb = placeGlb(c.fallback, {});
          fb.id = "place-fallback";
          fb.visible = false;
          root.add(fb);
        }
      }
    });

    const camera = new PerspectiveCamera(50, 16 / 9, 0.05, 5000);
    const st = place.start ?? { position: [0, 1.6, 8], target: [0, 1, 0] };
    camera.position.set(st.position[0], st.position[1], st.position[2]);
    camera.lookAt(st.target[0], st.target[1], st.target[2]);
    scene.add(camera);
    return { scene, camera };
  },

  frame,

  handlers: {
    later(tx) {
      tx.state.hour = (tx.state.hour + 1) % 24;
    },
    earlier(tx) {
      tx.state.hour = (tx.state.hour + 23) % 24;
    },
    night(tx) {
      tx.state.hour = tx.state.hour >= 19 || tx.state.hour < 5 ? 12 : 21;
    },
    ground(tx) {
      tx.state.ground = !tx.state.ground;
    },
    fallback(tx) {
      tx.state.fallback = !tx.state.fallback;
    },
  },

  keys: { T: "later", Y: "earlier", N: "night", G: "ground", F: "fallback" },
});
