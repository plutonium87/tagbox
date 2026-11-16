import { ensureSurfaceLoaded, getCustomSurfaces, getSurfaceEnvironmentParallax, getSurfacePaintMask, shouldPaintOverForeground, surfaceManifestPromise } from '../src/surfaces';

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

try {
  await surfaceManifestPromise;
  const surfaces = getCustomSurfaces();
  const truck = surfaces.find(({ id }) => id === 'deliverytruck');
  const doors = surfaces.find(({ id }) => id === 'steeldoors');
  check(Boolean(truck), 'Delivery Truck was not registered from the manifest.');
  check(Boolean(doors) && doors!.name === 'Steel Doors', 'Steel Doors was not registered from the manifest.');
  check(doors!.width === 1920 && doors!.height === 1080, 'Steel Doors logical dimensions are incorrect.');
  check(doors!.foregroundAbovePaint === true, 'Steel Doors handles must remain above painted content.');
  check(doors!.background === 'steeldoors_1920x1080.png' && doors!.foreground === 'steeldoors_fg_1920x1080.png', 'Steel Doors artwork registration is incorrect.');
  check(doors!.paintMask === 'steeldoors_paintmask_1920x1080.png' && doors!.ambience === '/audio/ambience/citypark.mp3', 'Steel Doors mask or ambience registration is incorrect.');
  check(shouldPaintOverForeground('deliverytruck'), 'Custom RGBA foregrounds must render beneath paint.');
  check(shouldPaintOverForeground('citypark') && shouldPaintOverForeground('norrtag'), 'Existing foreground surfaces must keep rendering beneath paint.');
  check(!shouldPaintOverForeground('storefront') && !shouldPaintOverForeground('industrial'), 'Surfaces without custom foregrounds must keep their current layer order.');
  check(!shouldPaintOverForeground('steeldoors'), 'Steel Doors fixed handles must render above paint.');
  check(getSurfaceEnvironmentParallax('steeldoors') === 1, 'Steel Doors background and foreground must share full canvas navigation offsets.');
  check(truck!.paintMaskAlphaSource === undefined, 'Delivery Truck should continue to use its authored grayscale paint mask directly.');
  await Promise.all(['citypark', 'deliverytruck', 'industrial', 'norrtag', 'storefront', 'steeldoors'].map((id) => checkThumbnail(`/surfaces/${id}-thumbnail.png`)));

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
  result.textContent = 'PASS\nDelivery Truck and Steel Doors masks align to their logical canvases; Steel Doors panels are paintable and its handles render above paint.';
} catch (error) {
  result.dataset.state = 'failed';
  result.textContent = `FAIL\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  throw error;
}
