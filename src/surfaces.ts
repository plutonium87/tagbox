import { CANVAS_HEIGHT, CANVAS_WIDTH } from './settings';
import type { RunoffObstacle } from './runoff';

export type CanvasSurface = string;
export interface CustomSurfaceDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  foreground?: string;
  foregroundAbovePaint?: boolean;
  paintMask?: string;
  aoMap?: string;
  paintMaskMode?: 'grayscale' | 'alpha';
  paintMaskAlphaSource?: 'foreground';
  fit?: 'contain' | 'cover' | 'stretch';
  navigationBounds?: 'paint-mask';
  environmentParallax?: number;
  ambience?: string;
  maps?: Record<string, string>;
}
export interface SurfaceDimensions { width: number; height: number }
interface LogicalBounds { x: number; y: number; width: number; height: number }
interface BuiltPaintMask { canvas: HTMLCanvasElement; bounds: LogicalBounds | null }
interface LoadedCustomSurface { definition: CustomSurfaceDefinition; configUrl: string; loaded: boolean; loading?: Promise<void>; background: HTMLImageElement | null; foreground: HTMLImageElement | null; paintMask: HTMLCanvasElement | null; aoMap: HTMLImageElement | null; paintBounds: LogicalBounds | null; ambience: string | null }
const customSurfaces = new Map<string, LoadedCustomSurface>();
const surfaceCacheOrder: string[] = [];

function loadOptionalImage(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => { void image.decode().then(() => resolve(image), () => resolve(null)); };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
function loadRequiredImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error(`Could not load ${new URL(url).pathname.split('/').at(-1) ?? 'surface image'}.`));
    image.onload = () => { void image.decode().then(() => resolve(image), () => reject(new Error(`Could not decode ${new URL(url).pathname.split('/').at(-1) ?? 'surface image'}.`))); };
    image.src = url;
  });
}

async function registerCustomSurface(id: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id === 'solid') return;
  try {
    const configUrl = `/surfaces/${id}/surface.json`;
    const response = await fetch(configUrl, { cache: 'no-cache' });
    if (!response.ok) return;
    const definition = await response.json() as CustomSurfaceDefinition;
    if (definition.id !== id || !definition.name || !Number.isFinite(definition.width) || definition.width < 1 || !Number.isFinite(definition.height) || definition.height < 1 || typeof definition.background !== 'string') return;
    const assetUrl = (path?: string): string | undefined => path ? new URL(path, new URL(configUrl, window.location.href)).href : undefined;
    customSurfaces.set(id, { definition, configUrl, loaded: false, background: null, foreground: null, paintMask: null, aoMap: null, paintBounds: null, ambience: assetUrl(definition.ambience) ?? null });
  } catch {
    // An invalid or unavailable custom entry is skipped; the rest of the app remains usable.
  }
}

export async function ensureSurfaceLoaded(id: string): Promise<void> {
  if (id === 'solid') { touchSurfaceCache(id); return; }
  const custom = customSurfaces.get(id);
  if (!custom || custom.loaded) {
    if (custom?.loaded) touchSurfaceCache(id);
    return;
  }
  if (custom.loading) return custom.loading;
  custom.loading = (async () => {
    const assetUrl = (path?: string): string | undefined => path ? new URL(path, new URL(custom.configUrl, window.location.href)).href : undefined;
    const backgroundUrl = assetUrl(custom.definition.background)!;
    const maskUrl = assetUrl(custom.definition.paintMask);
    const [background, foreground, paintMask, aoMap] = await Promise.all([
      loadRequiredImage(backgroundUrl),
      loadOptionalImage(assetUrl(custom.definition.foreground)),
      maskUrl ? loadRequiredImage(maskUrl) : Promise.resolve(null),
      loadOptionalImage(assetUrl(custom.definition.aoMap)),
    ]);
    const alignedMask = paintMask ? buildLogicalPaintMask(
      paintMask,
      custom.definition,
      custom.definition.paintMaskAlphaSource === 'foreground' ? foreground : null,
    ) : null;
    custom.background = background; custom.foreground = foreground;
    custom.paintMask = alignedMask?.canvas ?? null; custom.paintBounds = alignedMask?.bounds ?? null; custom.loaded = true;
    custom.aoMap = aoMap;
    touchSurfaceCache(id);
  })().finally(() => { custom.loading = undefined; });
  return custom.loading;
}

function touchSurfaceCache(id: string): void {
  const previous = surfaceCacheOrder.indexOf(id);
  if (previous >= 0) surfaceCacheOrder.splice(previous, 1);
  surfaceCacheOrder.push(id);
  while (surfaceCacheOrder.length > 2) {
    const evictedId = surfaceCacheOrder.shift()!;
    const evicted = customSurfaces.get(evictedId);
    if (evicted) { evicted.loaded = false; evicted.background = null; evicted.foreground = null; evicted.paintMask = null; evicted.aoMap = null; evicted.paintBounds = null; }
  }
}

function drawCustomImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, definition: CustomSurfaceDefinition): void {
  const { width: logicalWidth, height: logicalHeight, fit } = definition;
  if (!fit || fit === 'stretch') {
    ctx.drawImage(image, 0, 0, logicalWidth, logicalHeight);
    return;
  }
  const scale = fit === 'contain'
    ? Math.min(logicalWidth / image.naturalWidth, logicalHeight / image.naturalHeight)
    : Math.max(logicalWidth / image.naturalWidth, logicalHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, (logicalWidth - width) / 2, (logicalHeight - height) / 2, width, height);
}

function buildLogicalPaintMask(image: HTMLImageElement, definition: CustomSurfaceDefinition, alphaSource: HTMLImageElement | null): BuiltPaintMask | null {
  const mask = document.createElement('canvas');
  mask.width = definition.width;
  mask.height = definition.height;
  const context = mask.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  drawCustomImage(context, image, definition);
  const pixels = context.getImageData(0, 0, mask.width, mask.height);
  let alphaPixels: ImageData | null = null;
  if (alphaSource) {
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = definition.width;
    alphaCanvas.height = definition.height;
    const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true });
    if (alphaContext) {
      alphaContext.imageSmoothingEnabled = true;
      drawCustomImage(alphaContext, alphaSource, definition);
      alphaPixels = alphaContext.getImageData(0, 0, mask.width, mask.height);
    }
  }
  const calculateBounds = definition.navigationBounds === 'paint-mask';
  let left = mask.width;
  let top = mask.height;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < pixels.data.length; index += 4) {
    const maskOpacity = pixels.data[index + 3] / 255;
    const surfaceOpacity = alphaPixels ? alphaPixels.data[index + 3] / 255 : 1;
    const maskValue = definition.paintMaskMode === 'alpha' ? maskOpacity : (pixels.data[index] / 255) * maskOpacity;
    const paintability = maskValue * surfaceOpacity;
    const value = Math.round(paintability * 255);
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
    if (calculateBounds && (alphaPixels ? alphaPixels.data[index + 3] > 0 : value > 0)) {
      const pixel = index / 4;
      const x = pixel % mask.width;
      const y = Math.floor(pixel / mask.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  context.putImageData(pixels, 0, 0);
  return { canvas: mask, bounds: right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null };
}

export async function loadSurfaceManifest(): Promise<void> {
  try {
    const response = await fetch('/surfaces/manifest.json', { cache: 'no-cache' });
    if (response.ok) {
      const manifest = await response.json() as { surfaces?: unknown };
      if (Array.isArray(manifest.surfaces)) await Promise.all(manifest.surfaces.filter((id): id is string => typeof id === 'string').map(registerCustomSurface));
    }
  } catch {
    // Built-in surfaces remain available if the optional manifest cannot be loaded.
  }
  window.dispatchEvent(new Event('tagbox-custom-surfaces-ready'));
}
export const surfaceManifestPromise = loadSurfaceManifest();

export function getCustomSurfaces(): CustomSurfaceDefinition[] {
  return [...customSurfaces.values()].map(({ definition }) => definition);
}

export function getSurfaceDimensions(surface: CanvasSurface): SurfaceDimensions {
  const definition = customSurfaces.get(surface)?.definition;
  return definition ? { width: definition.width, height: definition.height } : { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

export function getSurfacePaintMask(surface: CanvasSurface): HTMLCanvasElement | null {
  return customSurfaces.get(surface)?.paintMask ?? null;
}

/** Custom foregrounds render beneath paint by default; surfaces can keep fixed details above it. */
export function shouldPaintOverForeground(surface: CanvasSurface): boolean {
  const definition = customSurfaces.get(surface)?.definition;
  return Boolean(definition?.foreground && !definition.foregroundAbovePaint);
}

export function getSurfaceAoMap(surface: CanvasSurface): HTMLImageElement | null {
  return customSurfaces.get(surface)?.aoMap ?? null;
}

export function getSurfaceNavigationBounds(surface: CanvasSurface): LogicalBounds | null {
  const custom = customSurfaces.get(surface);
  return custom?.definition.navigationBounds === 'paint-mask' ? custom.paintBounds : null;
}

export function getSurfaceAmbience(surface: CanvasSurface): string | null {
  return customSurfaces.get(surface)?.ambience ?? null;
}

export function getSurfaceEnvironmentParallax(surface: CanvasSurface): number {
  const value = customSurfaces.get(surface)?.definition.environmentParallax;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (surface === 'norrtag' ? 0.15 : 1);
}

export function drawSurface(ctx: CanvasRenderingContext2D, surface: CanvasSurface, solidColor: string): void {
  const { width, height } = getSurfaceDimensions(surface);
  ctx.clearRect(0, 0, width, height);
  if (surface === 'solid') {
    ctx.fillStyle = solidColor;
    ctx.fillRect(0, 0, width, height);
  } else {
    const custom = customSurfaces.get(surface);
    if (custom?.definition.fit === 'contain') {
      ctx.fillStyle = '#090a0b';
      ctx.fillRect(0, 0, width, height);
    }
    if (custom?.background) drawCustomImage(ctx, custom.background, custom.definition);
    else { ctx.fillStyle = '#343638'; ctx.fillRect(0, 0, width, height); }
  }
}

export function drawForeground(ctx: CanvasRenderingContext2D, surface: CanvasSurface): void {
  const { width, height } = getSurfaceDimensions(surface);
  ctx.clearRect(0, 0, width, height);
  const custom = customSurfaces.get(surface);
  if (custom?.foreground) drawCustomImage(ctx, custom.foreground, custom.definition);
}

export function getSurfaceObstacles(_surface: CanvasSurface): RunoffObstacle[] {
  return [];
}
