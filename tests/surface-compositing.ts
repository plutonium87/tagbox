import { drawNavigatorPreview } from '../src/navigator-preview';
import { applySurfaceLayerOrder, drawForeground, drawSurface, drawSurfaceBase, drawSurfaceComposite, ensureSurfaceLoaded, getCustomSurfaces, getSurfaceAmbience, getSurfaceCompositeOrder, getSurfaceDimensions, getSurfaceEnvironmentParallax, getSurfacePaintMask, shouldPaintOverForeground, surfaceManifestPromise, type SurfaceCompositeLayer } from '../src/surfaces';

const result = document.querySelector<HTMLElement>('#result')!;
const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
async function checkThumbnail(url: string): Promise<void> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Could not load selector thumbnail ${url}.`));
    image.src = url;
  });
  check(image.naturalWidth === 352 && image.naturalHeight === 198, `${url} must use the 352×198 selector thumbnail dimensions.`);
}
async function checkAsset(url: URL, width: number, height: number): Promise<void> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Could not load surface asset ${url.pathname}.`));
    image.src = url.href;
  });
  check(image.naturalWidth === width && image.naturalHeight === height, `${url.pathname} must be ${width}×${height}.`);
}

try {
  await surfaceManifestPromise;
  const surfaces = getCustomSurfaces();
  const truck = surfaces.find(({ id }) => id === 'deliverytruck');
  const doors = surfaces.find(({ id }) => id === 'steeldoors');
  const modelH = surfaces.find(({ id }) => id === 'model-h');
  check(Boolean(truck), 'Delivery Truck was not registered from the manifest.');
  check(Boolean(doors) && doors!.name === 'Steel Doors', 'Steel Doors was not registered from the manifest.');
  check(Boolean(modelH) && modelH!.name === 'Model H', 'Model H was not registered from the manifest.');
  check(surfaces.findIndex(({ id }) => id === 'model-h') === surfaces.findIndex(({ id }) => id === 'norrtag') + 1, 'Model H must appear immediately after Norrtåg in the surface selector.');
  check(modelH!.width === 3240 && modelH!.height === 1080, 'Model H logical dimensions are incorrect.');
  check(modelH!.background === '../modelh/modelh_freight_background_2172x724.png' && modelH!.fit === 'stretch', 'Model H must use its prepared background with full-canvas stretch.');
  check(modelH!.underlay === '../modelh/modelh_freight_3240x1080.png' && !modelH!.foreground, 'Model H must use the freight base as its only object artwork layer.');
  check(modelH!.paintMask === '../modelh/modelh_freight_paintmask_3240x1080.png', 'Model H paint mask registration is incorrect.');
  check(modelH!.paintMaskMode === 'grayscale' && modelH!.paintMaskAlphaSource === 'underlay' && modelH!.navigationBounds === 'paint-mask', 'Model H mask must use grayscale semantics and the freight base alpha.');
  check(getSurfaceAmbience('model-h') === '/audio/ambience/railway.mp3', 'Model H must reuse the Norrtåg ambience.');
  check(!shouldPaintOverForeground('model-h') && !shouldPaintOverForeground('steeldoors'), 'Model H has no separate foreground overlay; Steel Doors keeps its fixed foreground above paint.');
  check(getSurfaceCompositeOrder('model-h').join(',') === 'background,base,paint,runoff', 'Model H must composite background, freight base, paint and runoff.');
  check(getSurfaceEnvironmentParallax('model-h') === 0.075 && getSurfaceEnvironmentParallax('model-h') === getSurfaceEnvironmentParallax('norrtag'), 'Model H environment must use the same parallax factor as Norrtåg.');
  check(doors!.width === 1920 && doors!.height === 1080, 'Steel Doors logical dimensions are incorrect.');
  check(doors!.foregroundAbovePaint === true, 'Steel Doors handles must remain above painted content.');
  check(doors!.background === 'steeldoors_1920x1080.png' && doors!.foreground === 'steeldoors_fg_1920x1080.png', 'Steel Doors artwork registration is incorrect.');
  check(doors!.paintMask === 'steeldoors_paintmask_1920x1080.png' && doors!.ambience === '/audio/ambience/citypark.mp3', 'Steel Doors mask or ambience registration is incorrect.');
  check(shouldPaintOverForeground('deliverytruck'), 'Custom RGBA foregrounds must render beneath paint.');
  check(shouldPaintOverForeground('citypark') && shouldPaintOverForeground('norrtag'), 'Existing foreground surfaces must keep rendering beneath paint.');
  check(!shouldPaintOverForeground('storefront') && !shouldPaintOverForeground('industrial'), 'Surfaces without custom foregrounds must keep their current layer order.');
  check(!shouldPaintOverForeground('steeldoors'), 'Steel Doors fixed handles must render above paint.');
  check(getSurfaceCompositeOrder('steeldoors').join(',') === 'background,paint,runoff,foreground', 'Steel Doors must keep its handles above paint.');
  check(getSurfaceEnvironmentParallax('steeldoors') === 1, 'Steel Doors background and foreground must share full canvas navigation offsets.');
  check(truck!.paintMaskAlphaSource === undefined, 'Delivery Truck should continue to use its authored grayscale paint mask directly.');
  await Promise.all(['citypark', 'deliverytruck', 'industrial', 'model-h', 'norrtag', 'storefront', 'steeldoors'].map((id) => checkThumbnail(`/surfaces/${id}-thumbnail.png`)));

  for (const surface of [{ id: 'solid' }, ...surfaces]) {
    await ensureSurfaceLoaded(surface.id);
    const { width, height } = getSurfaceDimensions(surface.id);
    const background = document.createElement('canvas'); background.width = width; background.height = height;
    const base = document.createElement('canvas'); base.width = width; base.height = height;
    const foreground = document.createElement('canvas'); foreground.width = width; foreground.height = height;
    drawSurface(background.getContext('2d')!, surface.id, '#000000');
    drawSurfaceBase(base.getContext('2d')!, surface.id);
    drawForeground(foreground.getContext('2d')!, surface.id);
    const preview = document.createElement('canvas');
    preview.width = 220; preview.height = Math.round(220 * height / width);
    drawNavigatorPreview(preview.getContext('2d')!, { background, base, foreground }, preview.width, preview.height);
    const expected = document.createElement('canvas'); expected.width = preview.width; expected.height = preview.height;
    const expectedContext = expected.getContext('2d')!;
    expectedContext.fillStyle = '#17191a';
    expectedContext.fillRect(0, 0, expected.width, expected.height);
    for (const layer of [background, base, foreground]) expectedContext.drawImage(layer, 0, 0, expected.width, expected.height);
    const actualPixels = preview.getContext('2d')!.getImageData(0, 0, preview.width, preview.height).data;
    const expectedPixels = expectedContext.getImageData(0, 0, expected.width, expected.height).data;
    check(actualPixels.every((value, index) => value === expectedPixels[index]), `Navigator preview for ${surface.id} must match its static background and artwork layers.`);
    if (surface.id === 'solid') {
      const backgroundContext = background.getContext('2d')!;
      drawSurface(backgroundContext, 'solid', '#ff0000');
      drawNavigatorPreview(preview.getContext('2d')!, { background, base, foreground }, preview.width, preview.height);
      const colorAfterChange = preview.getContext('2d')!.getImageData(0, 0, preview.width, preview.height).data;
      check(colorAfterChange[0] === 255 && colorAfterChange[1] === 0 && colorAfterChange[2] === 0, 'Solid background color changes must be reflected in the Navigator preview.');
    }
  }

  const modelHConfigUrl = new URL('/surfaces/model-h/surface.json', window.location.href);
  await Promise.all([
    checkAsset(new URL(modelH!.background, modelHConfigUrl), 2172, 724),
    checkAsset(new URL(modelH!.underlay!, modelHConfigUrl), 3240, 1080),
    checkAsset(new URL(modelH!.paintMask!, modelHConfigUrl), 3240, 1080),
  ]);
  await ensureSurfaceLoaded('model-h');
  const modelHMask = getSurfacePaintMask('model-h');
  check(Boolean(modelHMask) && modelHMask!.width === 3240 && modelHMask!.height === 1080, 'Model H paint mask did not align to the configured logical dimensions.');
  const modelHMaskPixels = modelHMask!.getContext('2d')!.getImageData(0, 0, modelHMask!.width, modelHMask!.height).data;
  check(modelHMaskPixels[(10 * modelHMask!.width + 1620) * 4] === 0, 'Model H must not be paintable outside the base freight alpha.');
  check(modelHMaskPixels[(550 * modelHMask!.width + 1620) * 4] > 0, 'Model H paint mask must allow paint on the freight surface.');
  check(modelHMaskPixels[(680 * modelHMask!.width + 1420) * 4] > 0, 'Model H handle pixels must remain paintable under the shared grayscale mask.');
  check(modelHMaskPixels[(695 * modelHMask!.width + 1435) * 4] > 240, 'Model H paint mask must allow painting across the freight base coordinate space.');
  const modelHDimensions = getSurfaceDimensions('model-h');
  const modelHCanvas = document.createElement('canvas');
  modelHCanvas.width = modelHDimensions.width;
  modelHCanvas.height = modelHDimensions.height;
  drawSurface(modelHCanvas.getContext('2d')!, 'model-h', '#000000');
  check(modelHCanvas.width === 3240 && modelHCanvas.height === 1080, 'Model H background canvas did not fill its configured dimensions.');
  const modelHBackgroundContext = modelHCanvas.getContext('2d')!;
  check(modelHBackgroundContext.getImageData(0, 0, 1, 1).data[3] === 255 && modelHBackgroundContext.getImageData(3239, 1079, 1, 1).data[3] === 255, 'Model H background must cover the full canvas without letterboxing.');
  const modelHBase = document.createElement('canvas');
  modelHBase.width = modelHDimensions.width; modelHBase.height = modelHDimensions.height;
  drawSurfaceBase(modelHBase.getContext('2d')!, 'model-h');
  check(modelHBase.getContext('2d')!.getImageData(1420, 680, 1, 1).data[3] > 0, 'Model H freight base must remain visible in the Navigator preview.');
  const backgroundSkyPixel = modelHBackgroundContext.getImageData(1620, 100, 1, 1).data;
  check(backgroundSkyPixel[2] > backgroundSkyPixel[0], 'Model H background asset must load its blue railway environment.');
  const modelHPaint = document.createElement('canvas');
  modelHPaint.width = modelHDimensions.width;
  modelHPaint.height = modelHDimensions.height;
  const modelHPaintContext = modelHPaint.getContext('2d')!;
  modelHPaintContext.fillStyle = '#0000ff';
  modelHPaintContext.fillRect(1415, 675, 15, 15);
  const modelHComposite = document.createElement('canvas');
  modelHComposite.width = modelHDimensions.width;
  modelHComposite.height = modelHDimensions.height;
  const compositeContext = modelHComposite.getContext('2d')!;
  const layerCanvases = { background: modelHCanvas, base: modelHBase, foreground: document.createElement('canvas'), paint: modelHPaint, runoff: document.createElement('canvas') };
  for (const layer of getSurfaceCompositeOrder('model-h')) compositeContext.drawImage(layerCanvases[layer], 0, 0);
  const paintedFreight = compositeContext.getImageData(1420, 680, 1, 1).data;
  check(paintedFreight[2] > paintedFreight[0] && paintedFreight[2] > paintedFreight[1], 'Paint must render over the freight base.');
  const erasedPaint = document.createElement('canvas'); erasedPaint.width = modelHDimensions.width; erasedPaint.height = modelHDimensions.height;
  const erasedComposite = document.createElement('canvas'); erasedComposite.width = modelHDimensions.width; erasedComposite.height = modelHDimensions.height;
  modelHPaintContext.clearRect(1420, 680, 1, 1);
  const erasedLayers: Record<SurfaceCompositeLayer, CanvasImageSource> = { ...layerCanvases, paint: erasedPaint };
  drawSurfaceComposite(erasedComposite.getContext('2d')!, 'model-h', erasedLayers, modelHDimensions.width, modelHDimensions.height);
  const afterErase = erasedComposite.getContext('2d')!.getImageData(1420, 680, 1, 1).data;
  const baseOnly = document.createElement('canvas'); baseOnly.width = modelHDimensions.width; baseOnly.height = modelHDimensions.height;
  baseOnly.getContext('2d')!.drawImage(modelHCanvas, 0, 0); baseOnly.getContext('2d')!.drawImage(modelHBase, 0, 0);
  const basePixelAtFreight = baseOnly.getContext('2d')!.getImageData(1420, 680, 1, 1).data;
  check(modelHPaintContext.getImageData(1420, 680, 1, 1).data[3] === 0 && [...afterErase].every((value, index) => value === basePixelAtFreight[index]), 'Erasing must clear paint and leave the freight base unchanged.');
  const navigatorPreview = document.createElement('canvas');
  navigatorPreview.width = modelHDimensions.width; navigatorPreview.height = modelHDimensions.height;
  drawNavigatorPreview(navigatorPreview.getContext('2d')!, { background: modelHCanvas, base: modelHBase, foreground: document.createElement('canvas') }, modelHDimensions.width, modelHDimensions.height);
  const navigatorPixels = navigatorPreview.getContext('2d')!.getImageData(0, 0, modelHDimensions.width, modelHDimensions.height).data;
  const staticComposite = document.createElement('canvas'); staticComposite.width = modelHDimensions.width; staticComposite.height = modelHDimensions.height;
  const staticContext = staticComposite.getContext('2d')!;
  staticContext.drawImage(modelHCanvas, 0, 0); staticContext.drawImage(modelHBase, 0, 0);
  const staticPixels = staticContext.getImageData(0, 0, modelHDimensions.width, modelHDimensions.height).data;
  check(navigatorPixels.every((value, index) => value === staticPixels[index]), 'Navigator preview must match the static Model H background and freight base, excluding paint.');
  const navigatorSkyPixel = navigatorPreview.getContext('2d')!.getImageData(1620, 100, 1, 1).data;
  check(navigatorSkyPixel[2] > navigatorSkyPixel[0] && navigatorSkyPixel[2] === backgroundSkyPixel[2], 'Model H Navigator must include the railway background without parallax.');

  const stage = document.createElement('div');
  stage.className = 'canvas-stage paint-over-foreground';
  const editorLayers = ['background-layer', 'base-layer', 'foreground-layer', 'paint-layer', 'runoff-layer'].map((className) => {
    const layer = document.createElement('canvas'); layer.className = `surface-layer ${className}`;
    if (className === 'paint-layer') layer.id = 'paint-canvas';
    stage.append(layer); return layer;
  });
  document.body.append(stage);
  const editorLayerMap: Record<SurfaceCompositeLayer, HTMLCanvasElement> = {
    background: editorLayers[0], base: editorLayers[1], foreground: editorLayers[2], paint: editorLayers[3], runoff: editorLayers[4],
  };
  applySurfaceLayerOrder('model-h', editorLayerMap);
  const editorZ = editorLayers.map((layer) => Number(getComputedStyle(layer).zIndex));
  check(editorZ[0] < editorZ[1] && editorZ[1] < editorZ[3] && editorZ[3] < editorZ[4] && editorZ[2] === -1, 'Model H editor stack must place the freight base between the environment and paint, with no foreground layer.');
  stage.remove();

  await ensureSurfaceLoaded('deliverytruck');
  const mask = getSurfacePaintMask('deliverytruck');
  check(Boolean(mask), 'Delivery Truck paint mask did not load.');
  check(mask!.width === 3240 && mask!.height === 1080, 'Delivery Truck mask did not align to the logical surface size.');
  const pixels = mask!.getContext('2d')!.getImageData(0, 0, mask!.width, mask!.height).data;
  const valueAt = (x: number, y: number): number => pixels[(y * mask!.width + x) * 4];
  check(valueAt(1600, 400) > 240, 'Cargo-box paintable area is missing or the mask is inverted.');
  check(valueAt(600, 300) < 8, 'Transparent environment area should remain unpaintable.');
  check(valueAt(950, 400) > 30 && valueAt(950, 400) < 70, 'Windshield mask tone should remain authored rather than being replaced by foreground alpha.');

  await ensureSurfaceLoaded('steeldoors');
  const doorsMask = getSurfacePaintMask('steeldoors');
  check(Boolean(doorsMask), 'Steel Doors paint mask did not load.');
  check(doorsMask!.width === 1920 && doorsMask!.height === 1080, 'Steel Doors mask does not align to its logical surface size.');
  const doorsPixels = doorsMask!.getContext('2d')!.getImageData(0, 0, doorsMask!.width, doorsMask!.height).data;
  const doorsValueAt = (x: number, y: number): number => doorsPixels[(y * doorsMask!.width + x) * 4];
  check(doorsValueAt(500, 500) > 240 && doorsValueAt(1400, 500) > 240, 'Both Steel Doors panels must be paintable.');
  check(doorsValueAt(20, 20) < 8, 'The protected outer area must remain unpaintable.');
  result.dataset.state = 'passed';
  result.textContent = 'PASS\nModel H background, base, paint, static Navigator preview, selector thumbnail, and export checks pass.';
} catch (error) {
  result.dataset.state = 'failed';
  result.textContent = `FAIL\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  throw error;
}
