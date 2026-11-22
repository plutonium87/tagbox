export interface NavigatorStaticLayers {
  background: CanvasImageSource;
  base: CanvasImageSource;
  foreground: CanvasImageSource;
}

/** Draw the already-rendered static surface layers into the small Navigator preview. */
export function drawNavigatorPreview(
  context: CanvasRenderingContext2D,
  layers: NavigatorStaticLayers,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#17191a';
  context.fillRect(0, 0, width, height);
  for (const layer of [layers.background, layers.base, layers.foreground]) {
    context.drawImage(layer, 0, 0, width, height);
  }
}
