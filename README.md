# Tagbox

Tagbox is a browser-based graffiti painting application built with TypeScript, Vite and WebGL2.

Project version: **0.9.9 (release candidate)**.

**Live application:** [tagbox.kebabstugan.com](https://tagbox.kebabstugan.com)

## Features

- Marker with Round, Square, Chisel and Split Chisel tips. Non-round tips can be rotated.
- Spray with Standard and Calligraphy nozzles. Calligraphy has adjustable rotation.
- Paint, Silver Chrome, Copper Chrome and Gold Chrome materials. Chrome uses the shared environment reflection renderer.
- Adjustable Marker smoothing, Paint Load, Run Intensity and Paint Splatter. Spray has independent size, smoothing and pressure controls.
- Four selectable surfaces: Solid, Concrete, Steel Gate and Norrtåg. Custom surfaces can be registered through the surface manifest.
- Surface-native logical dimensions: Solid, Concrete and Steel Gate use 1920×1080; Norrtåg uses 2172×724. Custom surfaces declare their own dimensions.
- Norrtåg uses an environment background, transparent train foreground and grayscale paint mask combined with the train foreground alpha.
- Navigator thumbnail and viewport tracking, zoom and pan.
- Undo, clear-canvas, Fullscreen and timestamped native-dimension PNG export.
- Audio ambience and effects with master mute, separate Master, Ambience and Effects volume controls, and saved browser preferences.

## Controls

### Marker

- Marker Size: 2–30 px (default 10 px).
- Brush tips: Round, Square, Chisel and Split Chisel. Square, Chisel and Split Chisel support 0°–360° rotation.
- Stroke Smoothing: 0%–100% (default 50%).
- Paint Load: 0%–100% (default 68%).
- Run Intensity: 0%–100% (default 58%).
- Paint Splatter can be enabled or disabled.

### Spray

- Spray Size: 3–240 px (default 96 px).
- Standard and Calligraphy nozzles. Calligraphy uses a narrow oval spray and supports 0°–360° nozzle rotation.
- Smoothing: 0%–100% (default 45%); Pressure: 0%–100% (default 55%).
- Paint and all three Chrome materials are available.

### Colors and materials

Select a custom color, one of the 16 preset colors or a saved color. Selecting a paint color activates Paint for the current tool. Selecting Silver, Copper or Gold Chrome activates that Chrome material. Saved colors, brush color, Marker and Spray materials, solid background color, active surface, Paint Splatter state, and audio preferences persist in this browser. The active tool, sizes, tip/nozzle selections, rotations and other live adjustment controls return to their defaults on reload.

### Audio

- Spray effects: start, continuous loop and end; can-shake detection; cap-change sounds for Marker tip and Spray nozzle selection; and can-color sounds for color and Chrome selection.
- Ambient loops are selected by the active surface. Norrtåg uses Railway ambience; Steel Gate uses Urban ambience.
- The top sound button or settings-panel Sound control mutes or enables audio. Master, Ambience and Effects volumes are adjustable independently. These preferences are saved in this browser.
- Can-shake detection is limited to desktop mouse movement with Spray selected while not drawing.

## Navigation and interaction

### Mouse and keyboard

- Drag on the canvas to draw with the selected tool.
- Mouse wheel over the canvas zooms around the pointer, from fit-to-view up to 5×.
- Middle-button drag pans. Hold Space and left-drag to pan.
- Drag the Navigator map or viewport rectangle to change the view. The Navigator can be hidden or shown with its toggle.
- Use Undo Stroke or Ctrl+Z (⌘Z on Mac) to undo the last stroke. Use Clear Canvas or Delete to clear the canvas on desktop.
- Escape exits Fullscreen/canvas-only mode.
- Focus the Marker rotation dial and use arrow keys to rotate by 1° (Shift+arrow: 5°); Home and End select 0° and 360°.

### Touch

- One-finger touch draws. Two-finger movement on the canvas zooms and pans the view.
- Drag the Navigator map or viewport rectangle to pan.
- Undo and Clear remain available through their controls; there are no multi-finger undo or clear gestures.

### Fullscreen

Fullscreen expands the canvas workspace while keeping its available actions, including sound, export, undo, clear and help. If browser fullscreen is unavailable or denied, the app still enters its canvas-only layout. Escape or the Exit fullscreen control returns to the regular layout.

## Surfaces and export

Built-in surfaces are Solid, Concrete and Steel Gate at 1920×1080, plus Norrtåg at its native 2172×724 size. Each custom surface configuration declares its own logical width and height; display scaling fits that canvas to the viewport without changing its logical dimensions.

The custom surface loader reads public/surfaces/manifest.json and each registered surface's surface.json. Background, foreground and paint-mask images are resolved relative to that configuration. Norrtåg's paintability uses grayscale intensity multiplied by the alpha of its train foreground. See [Custom surface assets](public/surfaces/README.md).

Export PNG downloads the active logical canvas at the surface's native dimensions: 1920×1080 for the built-in surfaces and 2172×724 for Norrtåg. Custom surfaces export at their configured dimensions. Filenames include a local timestamp.

## Development

### Prerequisites

- Node.js 18 or newer
- npm
- A browser with WebGL2 support

Install dependencies and start the development server:

~~~sh
npm install
npm run dev
~~~

Vite prints the local development URL, usually http://localhost:5173.

To access the development server from another device on the LAN, bind Vite to all interfaces:

~~~sh
npm run dev -- --host 0.0.0.0
~~~

Create a production build with:

~~~sh
npm run build
~~~

The static production files are written to dist/. Use npm run preview to preview a production build locally.

## Deployment

The production image uses deploy/Dockerfile to serve the built dist/ directory with Nginx, using deploy/nginx.conf for static-file and SPA fallback handling. Build the site before building the container image:

~~~sh
npm run build
docker compose build
~~~

The Compose service attaches to the external Docker network kebabstugan_default. Create that network before starting the service if it does not already exist:

~~~sh
docker network inspect kebabstugan_default >/dev/null 2>&1 || docker network create kebabstugan_default
docker compose up -d
~~~

The Cloudflare Tunnel is external to this repository and is not started or configured by Compose. Connect the tunnel to the same Docker network and route the public hostname to the Tagbox container on HTTP port 80 (for example, http://tagbox:80). Configure DNS and tunnel credentials in the Cloudflare Tunnel deployment, outside this project.

## Project structure

~~~text
.
├── CHANGELOG.md
├── LICENSE
├── README.md
├── deploy/
│   ├── Dockerfile
│   └── nginx.conf
├── public/
│   ├── audio/
│   └── surfaces/
├── src/
│   ├── audio.ts
│   ├── brush.ts
│   ├── main.ts
│   ├── navigation.ts
│   ├── renderer.ts
│   ├── runoff.ts
│   ├── settings.ts
│   ├── smoothing.ts
│   ├── spray.ts
│   ├── style.css
│   ├── surfaces.ts
│   └── version.d.ts
├── compose.yml
├── index.html
├── package.json
├── package-lock.json
└── vite.config.ts
~~~

## Browser support and limitations

Tagbox requires a browser with WebGL2. Fullscreen depends on browser support; the canvas-only layout remains available if the Fullscreen API is unavailable. Artwork is held in memory for the current page session; projects cannot be saved or loaded. User preferences listed above use browser local storage where implemented. Large artworks retain stroke and runoff geometry for redraw and undo, so memory use and rendering cost can increase as artwork grows.

## License

Tagbox is released under the MIT License. See [LICENSE](LICENSE).
