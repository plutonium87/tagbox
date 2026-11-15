# Surface assets

## Custom surface structure

Register a custom surface by adding its ID to `public/surfaces/manifest.json` and creating a folder with this structure:

~~~text
public/surfaces/<id>/
├── surface.json
├── background image
├── optional foreground image
├── optional paint mask
└── optional ambient-occlusion map
~~~

Surface IDs may contain lowercase letters, digits and hyphens. Asset paths in surface.json resolve relative to that file. The background path is required. Foreground and paint mask paths are optional. Custom surfaces declare their own positive logical width and height; dimensions do not have to match other surfaces. The viewport scales the whole logical canvas for display, while drawing, masks, navigation and PNG export use the configured dimensions.

Example configuration:

~~~json
{
  "id": "brick-wall",
  "name": "Brick Wall",
  "width": 1920,
  "height": 1080,
  "background": "environment.webp",
  "foreground": "surface-details.png",
  "paintMask": "paint-mask.png",
  "paintMaskMode": "grayscale",
  "paintMaskAlphaSource": "foreground",
  "fit": "stretch",
  "environmentParallax": 1,
  "ambience": "/audio/ambience/example.mp3"
}
~~~

## Layers and coordinates

- **Background:** required environment or base surface image, drawn beneath paint.
- **Paint:** Marker and Spray deposits share the configured logical coordinate system. Marker runoff is rendered into the paint result.
- **Foreground:** optional transparent artwork. Custom surface foregrounds render beneath paint so masked artwork can be painted over. The built-in Steel Gate detail layer remains above paint.
- **Paint mask:** optional restriction and opacity field for Marker, Spray and runoff deposition.

The built-in Solid and Steel Gate surfaces use 1920×1080. Norrtåg, City Park, Industrial and Delivery Truck are registered at 3240×1080. Custom foregrounds use the same layer order in the main canvas, Navigator and PNG export. Norrtåg's background is the environment image, its foreground is the transparent train image, and its grayscale paint mask is multiplied by train alpha. Delivery Truck uses an authored grayscale mask that already defines paintability, including its glass and environment regions.

The fit option applies to background, foreground and paint mask: stretch (default) fills the configured dimensions; contain preserves the image ratio inside those bounds; cover preserves the ratio while filling and cropping to those bounds. Optional material maps use the same logical coordinates as the configured artwork and are sampled only while paint is deposited. Use native-sized, aligned files with the default fit when the source layers already match the configured dimensions.

## Paint mask interpretation

The default grayscale mode uses the red channel as mask intensity and multiplies it by the mask image's own alpha. Black blocks paint, white allows full deposition and gray scales deposition proportionally. If paintMaskAlphaSource is set to foreground, the mask is additionally multiplied by the alpha channel of the foreground image. This keeps transparent surface pixels unpaintable while retaining grayscale opacity and antialiased edges. Norrtåg uses this setting with its train foreground.

The alpha mode uses the paint-mask image's alpha channel as paintability and ignores its RGB values. If no mask is configured or the mask cannot be loaded, paint is unrestricted by a mask. When navigationBounds is paint-mask, bounds come from nonzero mask pixels; with paintMaskAlphaSource set to foreground, bounds instead follow nontransparent foreground pixels.

There is no separate paint-opacity-map input. Grayscale paint opacity is implemented through paintMask. The optional `aoMap` property provides restrained ambient-occlusion shading for deposited paint; it does not affect paintability or appear as a visible layer. Height, normal and roughness maps are not implemented.

## Registered custom surfaces

The manifest registers Norrtåg, City Park, Store front, Industrial and Delivery Truck. Their current configurations are:

- **Norrtåg:** 3240×1080; `norrtag_bg2.png` background, `norrtag_v3.png` foreground, and `norrtag_v3-paintmask.png` grayscale paint mask multiplied by foreground alpha. Uses Railway ambience.
- **City Park:** 3240×1080; `stone_wall__bg_3240x1080.png` background, `stone_wall_3240x1080.png` foreground, and `stone_wall_paintmask_3240x1080.png` grayscale paint mask. Uses park ambience.
- **Store front:** 1920×1080 with matching artwork and grayscale paint mask. Uses urban ambience.
- **Industrial:** 3240×1080 with matching artwork and grayscale paint mask, plus an aligned AO map sampled by paint shaders. Uses industrial ambience.
- **Delivery Truck:** 3240×1080 with a night-street background, transparent truck foreground and authored grayscale paint mask. Uses urban ambience.

Selector previews are stored as `public/surfaces/<id>-thumbnail.png`. They composite the configured background and foreground, then fit the complete scene into a 352×198 preview tile.

Static hosting cannot discover unregistered surface folders, so add each custom surface ID to the manifest and reload the app.
