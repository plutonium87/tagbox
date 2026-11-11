import { PointerFilter, StrokeInterpolator } from './smoothing';
import type { Material, Point, SprayNozzle, SprayStroke } from './settings';

const PARTICLE_STRIDE = 4;
const MAX_SAMPLES_PER_STROKE = 20_000;
const MAX_DEPOSITS_PER_STROKE = 20_000;

/** Generates one deterministic, bounded sequence of coherent aerosol deposits. */
export class SprayEngine {
  private active: SprayStroke | null = null;
  private filter: PointerFilter | null = null;
  private interpolator: StrokeInterpolator | null = null;
  private lastRaw: Point | null = null;
  private buffer = new Float32Array(0);
  private depositCount = 0;

  constructor(private readonly onChange: (stroke: SprayStroke, newParticles: Float32Array) => void) {}

  begin(point: Point, time: number, size: number, color: string, smoothing: number, pressure: number, material: Material = 'paint', nozzle: SprayNozzle = 'standard', rotation = 0): void {
    this.active = { kind: 'spray', points: [], particles: new Float32Array(0), size, color, pressure, material, nozzle, rotation };
    this.depositCount = 0;
    this.buffer = new Float32Array(0);
    this.filter = new PointerFilter(smoothing);
    // Calligraphy's narrow axis is only 18% of its diameter and its dabs fade
    // at the edge, so keep their centers close enough for consistent overlap.
    // A subpixel floor avoids a 1 px gap when the nib is at minimum size.
    // Standard Spray keeps its original spacing.
    const spacing = nozzle === 'calligraphy' ? Math.max(0.5, size * 0.045) : Math.max(2, size * 0.14);
    this.interpolator = new StrokeInterpolator(spacing);
    this.lastRaw = { ...point };
    const filtered = this.filter.push(point, time);
    this.emit(this.interpolator.push(filtered));
  }

  move(point: Point, time: number): void {
    if (!this.active || !this.filter || !this.interpolator || !this.lastRaw) return;
    const filtered = this.filter.push(point, time);
    this.emit(this.interpolator.push(filtered));
    this.lastRaw = { ...point };
  }

  end(): SprayStroke | null {
    if (!this.active || !this.filter || !this.interpolator) return null;
    const endpoint = this.lastRaw ?? this.active.points.at(-1)!;
    const exactEndpoint = this.filter.flush(endpoint);
    this.emit([...this.interpolator.push(exactEndpoint), ...this.interpolator.finish(exactEndpoint)]);
    const completed = this.active;
    completed.particles = this.buffer.slice(0, this.depositCount * PARTICLE_STRIDE);
    this.active = null;
    this.filter = null;
    this.interpolator = null;
    this.lastRaw = null;
    this.buffer = new Float32Array(0);
    this.depositCount = 0;
    this.onChange(completed, new Float32Array(0));
    return completed;
  }

  private emit(points: Point[]): void {
    if (!this.active || points.length === 0) return;
    const batchStart = this.depositCount * PARTICLE_STRIDE;
    const acceptedPoints = points.slice(0, Math.max(0, MAX_SAMPLES_PER_STROKE - this.active.points.length));
    const acceptedDeposits = acceptedPoints.slice(0, Math.max(0, MAX_DEPOSITS_PER_STROKE - this.depositCount));
    this.ensureCapacity((this.depositCount + acceptedDeposits.length) * PARTICLE_STRIDE);
    for (const point of acceptedDeposits) {
      this.active.points.push(point);
      this.emitSample(point);
    }
    const batchEnd = this.depositCount * PARTICLE_STRIDE;
    this.active.particles = this.buffer.subarray(0, batchEnd);
    this.onChange(this.active, this.buffer.subarray(batchStart, batchEnd));
  }

  private emitSample(point: Point): void {
    this.pushParticle(point.x, point.y, this.active!.size, this.active!.pressure);
  }

  private pushParticle(x: number, y: number, size: number, opacity: number): void {
    this.ensureCapacity((this.depositCount + 1) * PARTICLE_STRIDE);
    const offset = this.depositCount++ * PARTICLE_STRIDE;
    this.buffer[offset] = x;
    this.buffer[offset + 1] = y;
    this.buffer[offset + 2] = size;
    this.buffer[offset + 3] = Math.max(0, Math.min(1, opacity));
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return;
    const capacity = Math.max(required, this.buffer.length === 0 ? 256 : this.buffer.length * 2);
    const grown = new Float32Array(capacity);
    grown.set(this.buffer.subarray(0, this.depositCount * PARTICLE_STRIDE));
    this.buffer = grown;
  }

}
