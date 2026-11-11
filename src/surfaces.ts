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
  paintMask?: string;
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
interface LoadedCustomSurface { definition: CustomSurfaceDefinition; background: HTMLImageElement | null; foreground: HTMLImageElement | null; paintMask: HTMLCanvasElement | null; paintBounds: LogicalBounds | null; ambience: string | null }
const customSurfaces = new Map<string, LoadedCustomSurface>();

function loadOptionalImage(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function loadCustomSurface(id: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || id === 'solid' || id === 'steel-gate') return;
  try {
    const configUrl = `/surfaces/${id}/surface.json`;
    const response = await fetch(configUrl, { cache: 'no-cache' });
    if (!response.ok) return;
    const definition = await response.json() as CustomSurfaceDefinition;
    if (definition.id !== id || !definition.name || !Number.isFinite(definition.width) || definition.width < 1 || !Number.isFinite(definition.height) || definition.height < 1 || typeof definition.background !== 'string') return;
    const assetUrl = (path?: string): string | undefined => path ? new URL(path, new URL(configUrl, window.location.href)).href : undefined;
    const [background, foreground, paintMask] = await Promise.all([
      loadOptionalImage(assetUrl(definition.background)),
      loadOptionalImage(assetUrl(definition.foreground)),
      loadOptionalImage(assetUrl(definition.paintMask)),
    ]);
    const alignedMask = paintMask ? buildLogicalPaintMask(
      paintMask,
      definition,
      definition.paintMaskAlphaSource === 'foreground' ? foreground : null,
    ) : null;
    customSurfaces.set(id, { definition, background, foreground, paintMask: alignedMask?.canvas ?? null, paintBounds: alignedMask?.bounds ?? null, ambience: assetUrl(definition.ambience) ?? null });
  } catch {
    // An invalid or unavailable custom entry is skipped; the rest of the app remains usable.
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
      if (Array.isArray(manifest.surfaces)) await Promise.all(manifest.surfaces.filter((id): id is string => typeof id === 'string').map(loadCustomSurface));
    }
  } catch {
    // Built-in surfaces remain available if the optional manifest cannot be loaded.
  }
  window.dispatchEvent(new Event('tagbox-custom-surfaces-ready'));
}

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

export function getSurfaceNavigationBounds(surface: CanvasSurface): LogicalBounds | null {
  const custom = customSurfaces.get(surface);
  return custom?.definition.navigationBounds === 'paint-mask' ? custom.paintBounds : null;
}

export function getSurfaceAmbience(surface: CanvasSurface): string | null {
  if (surface === 'steel-gate') return 'urban';
  return customSurfaces.get(surface)?.ambience ?? null;
}

export function getSurfaceEnvironmentParallax(surface: CanvasSurface): number {
  const value = customSurfaces.get(surface)?.definition.environmentParallax;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : (surface === 'norrtag' ? 0.15 : 1);
}

const gateBackdropPhoto = new Image();
const gatePhoto = new Image();
const gateDetailsPhoto = new Image();
let gatePlate: HTMLCanvasElement | null = null;
let gateForegroundPlate: HTMLCanvasElement | null = null;
let gateBackdropReady = false;
let gateReady = false;
let gateDetailsReady = false;
gateBackdropPhoto.onload = () => { gateBackdropReady = true; window.dispatchEvent(new Event('tagbox-surface-assets-ready')); };
gatePhoto.onload = () => {
  gateReady = true;
  gatePlate = buildGatePlate();
  if (gateDetailsReady) gateForegroundPlate = buildGateForegroundPlate();
  window.dispatchEvent(new Event('tagbox-surface-assets-ready'));
};
gateDetailsPhoto.onload = () => {
  gateDetailsReady = true;
  if (gateReady) gateForegroundPlate = buildGateForegroundPlate();
  window.dispatchEvent(new Event('tagbox-surface-assets-ready'));
};
gateBackdropPhoto.src = '/concrete-photo-background.png';
gatePhoto.src = '/steel-gate-photo-background.png';
gateDetailsPhoto.src = '/steel-gate-photo-details.png';

const gatePhysicalRects = [
  { left: 108, top: 12, right: 1561, bottom: 45 },       // top rail
  { left: 108, top: 893, right: 1561, bottom: 925 },     // lower rail / threshold
  { left: 108, top: 35, right: 146, bottom: 906 },       // left jamb
  { left: 1525, top: 35, right: 1561, bottom: 906 },     // right jamb
  { left: 830, top: 35, right: 843, bottom: 906 },       // center opening
  { left: 752, top: 488, right: 819, bottom: 531 },      // left handle and shadow
  { left: 850, top: 488, right: 920, bottom: 531 },      // right handle and shadow
] as const;
const gateObstacleRects = [gatePhysicalRects[0], gatePhysicalRects[1]] as const;

function coverTransform(image: HTMLImageElement): { scale: number; x: number; y: number } {
  const scale = Math.max(CANVAS_WIDTH / image.naturalWidth, CANVAS_HEIGHT / image.naturalHeight);
  return { scale, x: (CANVAS_WIDTH - image.naturalWidth * scale) / 2, y: (CANVAS_HEIGHT - image.naturalHeight * scale) / 2 };
}

function gateTransform(image: HTMLImageElement): { scale: number; x: number; y: number } {
  const scale = CANVAS_HEIGHT / image.naturalHeight;
  return { scale, x: (CANVAS_WIDTH - image.naturalWidth * scale) / 2, y: 0 };
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement): void {
  const transform = coverTransform(image);
  ctx.drawImage(image, transform.x, transform.y, image.naturalWidth * transform.scale, image.naturalHeight * transform.scale);
}

function drawGatePhoto(ctx: CanvasRenderingContext2D): void {
  if (!gateReady || !gatePlate) { drawGateBackdrop(ctx); return; }
  drawGateBackdrop(ctx);
  ctx.drawImage(gatePlate, 0, 0);
}

function drawGateBackdrop(ctx: CanvasRenderingContext2D): void {
  if (gateBackdropReady) drawCover(ctx, gateBackdropPhoto);
  else { ctx.fillStyle = '#343638'; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); }
}

function buildGatePlate(): HTMLCanvasElement {
  const plate = document.createElement('canvas'); plate.width = CANVAS_WIDTH; plate.height = CANVAS_HEIGHT;
  const ctx = plate.getContext('2d')!;
  const transform = gateTransform(gatePhoto);
  ctx.drawImage(gatePhoto, transform.x, 0, gatePhoto.naturalWidth * transform.scale, CANVAS_HEIGHT);
  // Fade the gate image's outer margins into its shared photographic backdrop.
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, 0);
  const fade = 34;
  mask.addColorStop(0, 'rgba(255,255,255,0)');
  mask.addColorStop(Math.max(0, transform.x - 1) / CANVAS_WIDTH, 'rgba(255,255,255,0)');
  mask.addColorStop(Math.min(1, (transform.x + fade) / CANVAS_WIDTH), '#fff');
  mask.addColorStop(Math.min(1, (transform.x + gatePhoto.naturalWidth * transform.scale - fade) / CANVAS_WIDTH), '#fff');
  mask.addColorStop(Math.min(1, (transform.x + gatePhoto.naturalWidth * transform.scale + 1) / CANVAS_WIDTH), 'rgba(255,255,255,0)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mask; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  return plate;
}

function buildGateForegroundPlate(): HTMLCanvasElement {
  const foreground = document.createElement('canvas');
  foreground.width = gateDetailsPhoto.naturalWidth;
  foreground.height = gateDetailsPhoto.naturalHeight;
  const foregroundContext = foreground.getContext('2d', { willReadFrequently: true })!;
  foregroundContext.drawImage(gateDetailsPhoto, 0, 0);
  const detailPixels = foregroundContext.getImageData(0, 0, foreground.width, foreground.height);

  const base = document.createElement('canvas');
  base.width = gatePhoto.naturalWidth;
  base.height = gatePhoto.naturalHeight;
  const baseContext = base.getContext('2d', { willReadFrequently: true })!;
  baseContext.drawImage(gatePhoto, 0, 0);
  const basePixels = baseContext.getImageData(0, 0, base.width, base.height).data;

  for (let y = 0; y < foreground.height; y++) {
    for (let x = 0; x < foreground.width; x++) {
      const index = (y * foreground.width + x) * 4;
      const inPhysicalDetail = gatePhysicalRects.some((rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom);
      if (!inPhysicalDetail) {
        detailPixels.data[index + 3] = 0;
        continue;
      }
      const difference = Math.abs(detailPixels.data[index] - basePixels[index]) * 0.299
        + Math.abs(detailPixels.data[index + 1] - basePixels[index + 1]) * 0.587
        + Math.abs(detailPixels.data[index + 2] - basePixels[index + 2]) * 0.114;
      detailPixels.data[index + 3] = Math.round(Math.max(0, Math.min(1, (difference - 16) / 32)) * 255);
    }
  }
  foregroundContext.putImageData(detailPixels, 0, 0);
  return foreground;
}

export function drawSurface(ctx: CanvasRenderingContext2D, surface: CanvasSurface, solidColor: string): void {
  const { width, height } = getSurfaceDimensions(surface);
  ctx.clearRect(0, 0, width, height);
  if (surface === 'solid') {
    ctx.fillStyle = solidColor;
    ctx.fillRect(0, 0, width, height);
  } else if (surface === 'steel-gate') {
    drawGatePhoto(ctx);
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
  if (surface === 'steel-gate' && gateForegroundPlate) {
    const transform = gateTransform(gateDetailsPhoto);
    ctx.drawImage(gateForegroundPlate, transform.x, 0, gateForegroundPlate.width * transform.scale, CANVAS_HEIGHT);
  } else {
    const custom = customSurfaces.get(surface);
    if (custom?.foreground) drawCustomImage(ctx, custom.foreground, custom.definition);
  }
}

function toCanvasRect(rect: { left: number; top: number; right: number; bottom: number }, transform: { scale: number; x: number; y: number }): RunoffObstacle {
  return {
    left: transform.x + rect.left * transform.scale,
    top: transform.y + rect.top * transform.scale,
    right: transform.x + rect.right * transform.scale,
    bottom: transform.y + rect.bottom * transform.scale,
  };
}

export function getSurfaceObstacles(surface: CanvasSurface): RunoffObstacle[] {
  if (surface === 'steel-gate' && gateDetailsReady) {
    const transform = gateTransform(gateDetailsPhoto);
    return gateObstacleRects.map((rect) => toCanvasRect(rect, transform));
  }
  return [];
}

void loadSurfaceManifest();
