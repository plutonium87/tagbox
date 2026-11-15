import { ensureSurfaceLoaded, getCustomSurfaces, getSurfacePaintMask, shouldPaintOverForeground, surfaceManifestPromise } from '../src/surfaces';

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
  check(Boolean(truck), 'Delivery Truck was not registered from the manifest.');
  check(shouldPaintOverForeground('deliverytruck'), 'Custom RGBA foregrounds must render beneath paint.');
  check(shouldPaintOverForeground('citypark') && shouldPaintOverForeground('norrtag'), 'Existing foreground surfaces must keep rendering beneath paint.');
  check(!shouldPaintOverForeground('storefront') && !shouldPaintOverForeground('steel-gate'), 'Surfaces without custom foregrounds must keep their current layer order.');
  check(truck!.paintMaskAlphaSource === undefined, 'Delivery Truck should continue to use its authored grayscale paint mask directly.');
  await Promise.all(['citypark', 'deliverytruck', 'industrial', 'norrtag', 'storefront'].map((id) => checkThumbnail(`/surfaces/${id}-thumbnail.png`)));

  await ensureSurfaceLoaded('deliverytruck');
  const mask = getSurfacePaintMask('deliverytruck');
  check(Boolean(mask), 'Delivery Truck paint mask did not load.');
  check(mask!.width === 3240 && mask!.height === 1080, 'Delivery Truck mask did not align to the logical surface size.');
  const pixels = mask!.getContext('2d')!.getImageData(0, 0, mask!.width, mask!.height).data;
  const valueAt = (x: number, y: number): number => pixels[(y * mask!.width + x) * 4];
  check(valueAt(1600, 400) > 240, 'Cargo-box paintable area is missing or the mask is inverted.');
  check(valueAt(600, 300) < 8, 'Transparent environment area should remain unpaintable.');
  check(valueAt(950, 400) > 30 && valueAt(950, 400) < 70, 'Windshield mask tone should remain authored rather than being replaced by foreground alpha.');

  result.dataset.state = 'passed';
  result.textContent = 'PASS\nDelivery Truck uses the aligned grayscale mask and paints above its RGBA foreground; existing custom foreground layer order is preserved.';
} catch (error) {
  result.dataset.state = 'failed';
  result.textContent = `FAIL\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  throw error;
}
