# Surface assets

## Custom surface structure

Register a custom surface by adding its ID to `public/surfaces/manifest.json` and creating a folder with this structure:

~~~text
public/surfaces/<id>/
├── surface.json
├── background image
├── optional foreground image
└── optional paint mask
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
- **Foreground:** optional transparent surface details drawn above paint on the canvas display.
- **Paint mask:** optional restriction and opacity field for Marker, Spray and runoff deposition.

The built-in Solid, Concrete and Steel Gate surfaces use 1920×1080. Norrtåg uses its source-native 2172×724 dimensions. Its background is the environment image, its foreground is the transparent train image, and its paint mask is sampled at the same coordinates. Norrtåg exports use a surface-specific foreground/paint order in the current application.

The fit option applies to background, foreground and paint mask: stretch (default) fills the configured dimensions; contain preserves the image ratio inside those bounds; cover preserves the ratio while filling and cropping to those bounds. Use native-sized, aligned files with the default fit when the source layers already match the configured dimensions.

## Paint mask interpretation

The default grayscale mode uses the red channel as mask intensity and multiplies it by the mask image's own alpha. Black blocks paint, white allows full deposition and gray scales deposition proportionally. If paintMaskAlphaSource is set to foreground, the mask is additionally multiplied by the alpha channel of the foreground image. This keeps transparent surface pixels unpaintable while retaining grayscale opacity and antialiased edges. Norrtåg uses this setting with its train foreground.

The alpha mode uses the paint-mask image's alpha channel as paintability and ignores its RGB values. If no mask is configured or the mask cannot be loaded, paint is unrestricted by a mask. When navigationBounds is paint-mask, bounds come from nonzero mask pixels; with paintMaskAlphaSource set to foreground, bounds instead follow nontransparent foreground pixels.

There is no separate paint-opacity-map input. Grayscale paint opacity is implemented through paintMask. Although surface.json accepts a maps object for compatibility, those entries are not loaded or rendered. Roughness and normal maps are not implemented or configured as planned assets.

## Current Norrtåg configuration

The manifest currently registers Norrtåg. Its folder contains:

- norrtag_bg.png: 2172×724 environment/background layer.
- norrtag_v2.png: 2172×724 RGBA train foreground and paintability alpha source.
- paint-mask.png: 2172×724 grayscale paint mask.
- surface.json: dimensions, layer paths, mask mode, alpha source, navigation bounds, parallax and Railway ambience.

Static hosting cannot discover unregistered surface folders, so add each custom surface ID to the manifest and reload the app.
