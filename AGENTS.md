# A place on EarthRT

This repository is one **place** on [EarthRT](https://github.com/threert/EarthRT), the whole Earth path-traced by
ThreeRT: a room, a building, a garden or a city at a real spot on the map. `earthrt.json` says where it is and what it
holds; the files it names are its content. Registered with EarthRT's index, it shows on the globe for everyone, on the
web (three.js) and in the EarthRT app (every light traced by ThreeRT). Several people may make the same thing: those are
versions of one **topic**, ranked by likes and the repository's stars.

You (a coding agent) build the place here, usually inside the **EarthRT app**: its Create here / Remix made this folder
(`~/EarthRT/places/<name>`), opened it in dev mode and started you in its agent panel. Read this file through before
you change anything.

## The loop

| what | command |
| --- | --- |
| the place on the globe, path-traced, reloading on save | the EarthRT app, in dev mode: already on when the app started you; else `bun run dev --app` |
| the same on the web (three.js) | `bun run dev` (opens earth.threert.dev with `?dev=`) |
| is it ready | `bun run check` (errors stop a publish; fix every one) |
| the scene → `dist/scene.js` | `bun run build` (the app builds on save for its own view; commit a build) |
| the scene → `assets/models/scene.glb`, what the web shows | `bun run bake` |
| models from Meshy | `bun run meshy text "…" --name x --height 2` |
| where it is | `bun run place --at <lat,lon or a map link> [--heading deg] [--radius m]` |
| publish | the app's **Publish**, or commit and `bun run register` |

**Look at what you made** before you call it done: the app shows the place where it stands on the Earth. Optional, if
ThreeRT is installed (`/Applications/ThreeRT.app`): `threert dev --detach` runs `preview.ts`, the place alone under its
real sun, path-traced, and `threert shot -o .threert/shot.png` saves a frame you can read (`--camera
'{"position":[x,y,z],"target":[x,y,z],"fov":40}'` to look from elsewhere; keys `T`/`Y` move the hour, `N` night,
`G` the ground, `F` the web's fallback GLB instead of the scene, as `threert key T`).

Do not edit `earthrt/` (a copy of EarthRT's core: `bun run sync-earthrt`), `dist/` (built) or `preview.ts` (the
optional preview) unless the task is about them.

## The frame and units

- Everything is in **metres** in the **place's frame**: **x east, y up, z south**, with the origin at the anchor on
  the ground (three.js and glTF axes: right-handed, y up). `heading` turns the frame about y: the place's forward
  (−z) points `heading` degrees clockwise from north. Heading 0: −z is north, +x is east.
- **y = 0 is the ground at the anchor** (`heightRef: "terrain"`: EarthRT puts the anchor on its terrain there).
  The terrain is a 30–40 m grid: on a slope, or for a building with a plinth, give it a base that goes a metre or two
  below y = 0 so no gap shows where the ground falls away.
- Everything stays inside `bounds` (a radius about the anchor, or a polygon of `[lat, lon]`); `replaces:
  ["buildings"]` hides EarthRT's own (OpenStreetMap) buildings inside it, which you want when you build a building
  that stands where one of those is.
- A place is seen from `visibleFrom` metres (defaults: interior 300, site 3000, city 30 000) and the camera may come
  to `minDistance` of its content. `start` is where "Go there" puts the camera, in the place's frame.

How big things are (use these; models from anywhere come at any scale):

| thing | size |
| --- | --- |
| a person | 1.7 m tall, eyes at 1.6 m |
| a door | 0.9 × 2.0 m (a Japanese sliding door ~0.9 × 1.8 m) |
| a tatami mat | 1.91 × 0.955 m in Kyoto (kyōma), 1.76 × 0.88 m in Tokyo; 5.5 cm thick |
| a storey | 2.6–3.0 m (houses), 3.5–4.5 m (shops, offices) |
| a Kyoto machiya | 5–6 m frontage, 15–30 m deep, 7–8 m to the ridge |
| a table, a chair seat | 0.72 m, 0.45 m high |
| a car | 4.5 × 1.8 × 1.5 m |
| a street tree | 8–15 m; a city block | 80–150 m |

## Where it is: the anchor

Pick a point you can find on a map to a metre: a building's corner, a door, the middle of a hall, a statue. Then
`bun run place --at <it>` takes:

- `35.00366,135.77512` (latitude, longitude: decimal degrees, WGS84),
- a Google Maps link (a pin's `!3d…!4d…` or the view's `@lat,lon`), an OpenStreetMap link (`?mlat=…&mlon=…` or
  `#map=19/lat/lon`), an Apple Maps link, or an EarthRT link (`?at=lat,lon,alt`).

`--heading 90` turns the frame (forward = east), `--face <lat,lon or link>` faces a point (a building's front faces
its street: face a point across the street). Build along the axes after that: a building whose front is the place's
forward has its front at −z. The command prints map links to check the anchor by eye; `bun run dev` shows it on
EarthRT's globe beside the trunk's buildings, which is the real check.

## What a place holds (`content`)

| type | what | where it shows |
| --- | --- | --- |
| `glb` | a model, placed by `position` (m), `rotation` (degrees, XYZ), `scale` in the place's frame | web and app |
| `scene` | a ThreeRT scene module: `scene/main.ts`, built to `dist/scene.js` | app; the web draws its `fallback` GLB |
| `tiles` | a city's own tiles (EarthRT's tile format, SPEC § 4) | both (for whole cities; see EarthRT's docs) |

Use a **scene** for what is made in code (rooms, procedural buildings, lights, anything that should look right when
traced) and **glb** for models (from Meshy, or CC0 ones). A scene can also load models (`new GLTFModel("assets/…")`),
but list a model as `glb` content when the web should show it too: `bake` does not put models a scene loads into the
fallback.

### Scene code (`scene/main.ts`)

```ts
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, type Object3D } from "@threert/scene";
import type { PlaceContext } from "./context.ts";

export default function build(ctx: PlaceContext): Object3D {
  const root = new Group();
  // … meshes in the place's frame (metres, y up, y = 0 the ground at the anchor) …
  return root;
}
```

- Imports only from `@threert/scene` (three.js's classes: `Mesh`, `*Geometry`, `MeshStandardMaterial`,
  `MeshPhysicalMaterial`, `PointLight`, `SpotLight`, `RectAreaLight`, `GLTFModel`, `InstancedMesh`, …) and your own
  files under `scene/` (bundled in). No DOM, no network, no timers. `build` runs once; return the whole place.
- **No sun, no sky, no camera**: those are EarthRT's (the real sun over the anchor at the viewer's time).
- Physical units: point and spot lights in **candela** (a candle ~1, a 60 W bulb ~70, a paper lantern 10–50);
  `emissiveIntensity` in **nits** (a lit paper window 100–300, a screen 200–500, a neon tube 1000+). Every emissive
  surface lights what is around it when traced: a lamp's shade glowing is often the whole light. Don't add fill
  lights to fake bounce light: tracing does it.
- Materials: `roughness` and `metalness` like three.js; colours are sRGB hex as in three.js. Wood 0.5–0.8 roughness,
  plaster 0.9, polished floor 0.2, paper 0.8; glass `MeshPhysicalMaterial({ transmission: 1, roughness: 0, ior: 1.5 })`.
- Interiors: real walls with thickness, a ceiling, window openings: light comes in through the openings and bounces.
  Leave a way to see in (`start` inside, or an open side) and keep `minDistance` small (0.3).
- Keep it light: up to a few hundred thousand triangles for a building; `InstancedMesh` for repeats (tatami, roof
  tiles, books).
- `ctx.time` is the local solar time at the place (hours): a scene may light lamps at dusk. `ctx.place` is the
  manifest. `ctx.readFile(path)` reads a file of the place (not in the preview).
- ThreeRT's reference for materials, lights and their values:
  `/Applications/ThreeRT.app/Contents/Resources/sdk/engine/.claude/skills/threert-scene-authoring/SKILL.md`; small
  scenes in `…/sdk/engine/compare/hello/threert/`; the API in `…/sdk/engine/packages/scene/src/`.

After changing the scene: `bun run build && bun run bake`, and commit `dist/` and the fallback GLB with the source
(the index serves the repository's files as committed; nothing builds them there).

## Models with Meshy

[Meshy](https://www.meshy.ai) makes textured models from a sentence or a picture. With the user's own key in
`MESHY_API_KEY` (https://www.meshy.ai/developers/keys; each model costs their credits: say how many you are about to
make). The app's Meshy panel does the same for a person without you:

```sh
bun run meshy text "a weathered granite Japanese stone lantern, moss on the roof" --name lantern --height 1.8 --at 2,-1
bun run meshy image photo.jpg --name bench --size 1.8 --rotate 90         # a photo (or several views of one thing)
bun run meshy resume <task-id> --name lantern --height 1.8                # a task that was interrupted
bun run meshy fit assets/models/lantern.glb --height 1.6 --at 0,0         # re-size or move a model you have
bun run meshy balance
bun run meshy text "anything" --name test --height 1 --mock               # no key, no credits: a placeholder cube
```

- Meshy's models have no real size: `--height` (m) or `--size` (its largest horizontal extent, m) scales it;
  `--at x,z` puts its footprint's centre there, standing on `--y` (default 0, the ground); `--rotate` turns it about
  up. The entry goes into `earthrt.json` (`--no-place` only saves the file), and "Model made with Meshy" into
  `credits`. Check it in the preview and move it with `fit` until it sits right.
- Prompts: one object, its material and state, its style ("a lacquered red wooden torii gate, slightly worn"), not a
  scene. Things that are many objects (a room, a street) are better as a scene with Meshy models for the props.
- `--mock` runs the tool against a local stand-in for Meshy (a placeholder cube): to try the tool, never for a
  place (`check` refuses it). Meshy keeps a task's files for 3 days: `resume` an interrupted task within that.
- Defaults: Meshy's latest model, remeshed to 30 000 triangles (`--polycount`), PBR textures (`--no-pbr` for colour
  only), GLB only.

## Licences and credits

Only content you may give everyone: **your own work, models made with Meshy (with the user's key), and CC0**
(Poly Haven, ambientCG, Kenney, Quaternius). Nothing ripped from games or scanned from sites without a CC0 licence;
no CC-BY-NC or "editorial use" models. Data from OpenStreetMap (footprints, heights, names) is ODbL: credit it.

- `license` is the licence of the place's content (`CC0-1.0`, `CC-BY-4.0`, …).
- `credits` lists what must be credited: `"Model made with Meshy"`, `"© OpenStreetMap contributors"`, an author's
  name for their CC0 work if you like. Write where each asset came from in `assets/CREDITS.md`.
- `check` fails a place that uses Meshy or OpenStreetMap without crediting them.

## Check and limits

`bun run check` runs `validatePlace` (exactly what EarthRT's index runs), checks every file the manifest names, that
`dist/` matches `scene/`, that the scene runs and stays in its bounds, that the fallback is current, and each GLB:

| limit | error | warning |
| --- | --- | --- |
| one GLB | 64 MiB | 16 MiB |
| triangles in all models | interior 1 M, site 1.5 M, city 8 M | 300 k, 500 k, 3 M |
| a texture | 8192 px | 2048 px |
| required glTF extensions | Draco, meshopt, Basis (neither host decodes them) | |
| a file in git | 100 MB (GitHub's limit) | |

## On the Earth: dev mode

- **In the app** (EarthRT for macOS): a place folder open in dev mode (Create here, Remix, File → Open Place Folder,
  or `bun run dev --app`, which opens `earthrt://dev?path=<this folder>`) is drawn inside the globe at its anchor,
  path-traced; the app builds the scene module on every save and reloads the place.
- **On the web**: `bun run dev` serves this folder at `http://127.0.0.1:8797/place/` and opens EarthRT's page with
  `?dev=` that address; it rebuilds and bakes the scene on every save and the page reloads the place. `--proxy` serves
  the web app from this machine too, for a browser that will not let an https page read `http://127.0.0.1` (Chrome
  asks once to allow "local network access": allow it).

## Publishing

1. `bun run check` passes; commit everything (`dist/`, the GLBs).
2. In the app: **Publish** (a repository under the user's GitHub account, the `earthrt-place` topic, registered). Or
   `bun run register`: it pushes, makes sure the repository is public with the topic, and registers it with EarthRT's
   index (`https://earth.threert.dev/api/v1`, signed in as `gh auth token`); `--create owner/name` makes the GitHub
   repository first. Later commits: the same again refreshes it (each commit is a version). The index also finds
   repositories with the topic `earthrt-place` by itself, hourly.
3. It prints the place's address on EarthRT. Likes there and stars here rank it among the versions of its topic.

**Topics.** `topic` says what the place is a version of: `site:kyoto-tower`, `interior:gion-machiya`, `city:kyoto`.
Making your own version of something that exists? Use its topic: people choose between the versions. An era is a
topic too: `city:kyoto@meiji`, `site:kyoto-station@1997`, with `era: { "label": "Meiji", "year": 1900 }`.

## Files

```
earthrt.json          the place (SPEC § 5 of EarthRT)
scene/main.ts         the scene module's source; scene/context.ts: what build(ctx) gets
dist/scene.js         the built scene module (bun run build; committed)
assets/models/        GLB models (+ <name>.meshy.json for Meshy's), scene.glb: the scene's fallback (bun run bake)
assets/CREDITS.md     where each asset came from
tools/                build, bake, check, place, meshy, dev, register, sync-earthrt
preview.ts            optional: the place alone in ThreeRT (`threert dev`), with threert.config.json
earthrt/              a copy of EarthRT's core (manifest check, frames, sun): bun run sync-earthrt
```
