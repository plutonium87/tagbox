import type { Point } from './settings';

export const MAX_CANVAS_ZOOM = 5;

export class CanvasNavigation {
  readonly logical: { width: number; height: number };
  readonly viewport = { width: 1, height: 1 };
  readonly pan: Point = { x: 0, y: 0 };
  private bounds: { x: number; y: number; width: number; height: number };
  baseScale = 1;
  zoom = 1;
  readonly maxZoom = MAX_CANVAS_ZOOM;

  constructor(width: number, height: number) {
    this.logical = { width, height };
    this.bounds = { x: 0, y: 0, width, height };
  }

  get scale(): number { return this.baseScale * this.zoom; }
  get minZoom(): number {
    return this.viewport.width / (this.logical.width * this.baseScale);
  }

  resize(width: number, height: number, baseScale: number): void {
    const center = this.logicalCenter();
    this.viewport.width = Math.max(1, width);
    this.viewport.height = Math.max(1, height);
    this.baseScale = Math.max(Number.EPSILON, baseScale);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    this.setLogicalCenter(center);
    this.clamp();
  }

  setZoomAt(nextZoom: number, point: Point): void {
    const oldScale = this.scale;
    const minZoom = this.minZoom;
    this.zoom = Math.max(minZoom, Math.min(this.maxZoom, nextZoom));
    const ratio = this.scale / oldScale;
    const center = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    this.pan.x = point.x - center.x - (point.x - center.x - this.pan.x) * ratio;
    this.pan.y = point.y - center.y - (point.y - center.y - this.pan.y) * ratio;
    this.clamp();
  }

  setPan(x: number, y: number): void { this.pan.x = x; this.pan.y = y; this.clamp(); }
  setLogicalSize(width: number, height: number): void {
    const center = this.logicalCenter();
    const normalizedCenter = { x: center.x / this.logical.width, y: center.y / this.logical.height };
    this.logical.width = Math.max(1, width);
    this.logical.height = Math.max(1, height);
    this.setLogicalCenter({ x: normalizedCenter.x * this.logical.width, y: normalizedCenter.y * this.logical.height });
  }
  setBounds(bounds: { x: number; y: number; width: number; height: number } | null): void {
    this.bounds = bounds && bounds.width > 0 && bounds.height > 0
      ? { ...bounds }
      : { x: 0, y: 0, width: this.logical.width, height: this.logical.height };
    this.clamp();
  }
  panBy(x: number, y: number): void { this.setPan(this.pan.x + x, this.pan.y + y); }
  setTransform(zoom: number, pan: Point): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.pan.x = pan.x;
    this.pan.y = pan.y;
    this.clamp();
  }

  setLogicalCenter(center: Point): void {
    this.pan.x = (this.logical.width / 2 - center.x) * this.scale;
    this.pan.y = (this.logical.height / 2 - center.y) * this.scale;
    this.clamp();
  }

  logicalCenter(): Point {
    return { x: this.logical.width / 2 - this.pan.x / this.scale, y: this.logical.height / 2 - this.pan.y / this.scale };
  }

  visibleLogicalRect(): { x: number; y: number; width: number; height: number } {
    const center = this.logicalCenter();
    const width = this.viewport.width / this.scale;
    const height = this.viewport.height / this.scale;
    return { x: center.x - width / 2, y: center.y - height / 2, width, height };
  }

  private clamp(): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    const offsetX = (this.bounds.x + this.bounds.width / 2 - this.logical.width / 2) * this.scale;
    const offsetY = (this.bounds.y + this.bounds.height / 2 - this.logical.height / 2) * this.scale;
    const maxX = Math.max(0, (this.bounds.width * this.scale - this.viewport.width) / 2);
    const maxY = Math.max(0, (this.bounds.height * this.scale - this.viewport.height) / 2);
    this.pan.x = Math.max(offsetX - maxX, Math.min(offsetX + maxX, this.pan.x));
    this.pan.y = Math.max(offsetY - maxY, Math.min(offsetY + maxY, this.pan.y));
  }
}
