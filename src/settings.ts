export interface Point { x: number; y: number }
export type BrushShape = 'round' | 'square' | 'chisel' | 'split-chisel';
export type Material = 'paint' | 'silver-chrome' | 'copper-chrome' | 'gold-chrome';
export type SprayNozzle = 'standard' | 'hollow-cone' | 'calligraphy' | 'spider';
export type ActiveSprayNozzle = Exclude<SprayNozzle, 'standard'>;
export function restoreSprayNozzle(value: string | null): ActiveSprayNozzle {
  if (value === 'calligraphy' || value === 'spider') return value;
  // `standard` was the former default. Keep old saved preferences and strokes readable.
  return 'hollow-cone';
}
export interface BrushSettings { size: number; color: string; material: Material; smoothing: number; wetness: number; intensity: number }
export interface Dab extends Point { size: number; color: string; load: number; paintLoad: number; speed: number; velocity: number; angle: number }
export interface SecondarySplatterRunoff extends Point { width: number; length: number; maxLength: number; requestedMaxLength: number; speed: number; age: number; seed: number; started: boolean }
export interface SplatterParticle extends Point { originX: number; originY: number; vx: number; vy: number; radius: number; aspect: number; age: number; lifetime: number; gravity: number; secondaryRunoff?: SecondarySplatterRunoff }
export interface Stroke { points: Point[]; dabs: Dab[]; splatter?: SplatterParticle[]; splatterEnabled?: boolean; size: number; color: string; material: Material; shape: BrushShape; rotation: number }
export interface SprayStroke { kind: 'spray'; points: Point[]; particles: Float32Array; timeline: Array<{ time: number; point: Point; filament: number; weaveFrequency: number; speed?: number; deposition?: number; phase?: number }>; size: number; color: string; pressure: number; material: Material; nozzle: SprayNozzle; rotation: number; weaveFrequency: number; hollowSeed?: number }
export type PaintOperation = { kind: 'marker'; stroke: Stroke } | { kind: 'spray'; stroke: SprayStroke } | { kind: 'erase'; stroke: Stroke };

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
export const MIN_BRUSH_SIZE = 2;
export const MAX_BRUSH_SIZE = 30;
export function clampBrushSize(size: number): number {
  return Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Number.isFinite(size) ? size : MIN_BRUSH_SIZE));
}

export const MIN_SPRAY_SIZE = 3;
export const MAX_SPRAY_SIZE = 240;
export function clampSpraySize(size: number): number {
  return Math.max(MIN_SPRAY_SIZE, Math.min(MAX_SPRAY_SIZE, Number.isFinite(size) ? size : MIN_SPRAY_SIZE));
}

export const MIN_SPIDER_WEAVE_RATE = 10;
export const MAX_SPIDER_WEAVE_RATE = 100;
export const DEFAULT_SPIDER_WEAVE_RATE = 50;
export function clampSpiderWeaveRate(rate: number): number {
  const normalized = Number.isFinite(rate) ? Math.round(rate) : DEFAULT_SPIDER_WEAVE_RATE;
  return Math.max(MIN_SPIDER_WEAVE_RATE, Math.min(MAX_SPIDER_WEAVE_RATE, normalized));
}
export function restoreSpiderWeaveRate(value: string | null): number {
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value))) return DEFAULT_SPIDER_WEAVE_RATE;
  return clampSpiderWeaveRate(Number(value));
}

export const settings: BrushSettings & { shape: BrushShape; rotationDegrees: number; splatterEnabled: boolean } = { size: 10, color: '#ffffff', material: 'paint', smoothing: 0.5, wetness: 0.68, intensity: 0.58, shape: 'round', rotationDegrees: 0, splatterEnabled: true };
export const spraySettings = { size: 96, pressure: 0.55, smoothing: 0.45, material: 'paint' as Material, nozzle: 'hollow-cone' as SprayNozzle, rotationDegrees: 0, weaveRate: DEFAULT_SPIDER_WEAVE_RATE };
export const eraserSettings = { size: 28 };
