import { PointerFilter, StrokeInterpolator } from './smoothing';
import { DEFAULT_SPIDER_WEAVE_SPEED, clampSpiderWeaveSpeed, type Material, type Point, type SprayNozzle, type SprayStroke } from './settings';

const PARTICLE_STRIDE = 4;
const MAX_SAMPLES_PER_STROKE = 20_000;
const MAX_DEPOSITS_PER_STROKE = 20_000;
const SPIDER_TICK_MS = 16;
export const SPIDER_WEAVE_FREQUENCY = DEFAULT_SPIDER_WEAVE_SPEED;

/** Generates deterministic spray deposits and Spider's resampled filament path. */
export class SprayEngine {
  private active: SprayStroke | null = null;
  private filter: PointerFilter | null = null;
  private interpolator: StrokeInterpolator | null = null;
  private lastRaw: Point | null = null;
  private buffer = new Float32Array(0);
  private depositCount = 0;
  private spiderPreviousFilaments: [Point | null, Point | null] = [null, null];
  private spiderInputs: Array<{ time: number; point: Point }> = [];
  private spiderSimulationTime = 0;
  private spiderNextTick = 0;
  private spiderCenter: Point | null = null;
  private spiderProgress: [number, number] = [0, 0];
  private spiderProgressTime = 0;

  constructor(
    private readonly onChange: (stroke: SprayStroke, newParticles: Float32Array) => void,
    private readonly defaultSpiderWeaveFrequency = SPIDER_WEAVE_FREQUENCY,
  ) {}

  begin(point: Point, time: number, size: number, color: string, smoothing: number, pressure: number, material: Material = 'paint', nozzle: SprayNozzle = 'standard', rotation = 0, weaveFrequency = this.defaultSpiderWeaveFrequency): void {
    this.active = { kind: 'spray', points: [], particles: new Float32Array(0), timeline: [], size, color, pressure, material, nozzle, rotation, weaveFrequency: clampSpiderWeaveSpeed(weaveFrequency) };
    this.depositCount = 0;
    this.spiderPreviousFilaments = [null, null];
    this.spiderInputs = [{ time, point: { ...point } }];
    this.spiderSimulationTime = time;
    this.spiderNextTick = time + SPIDER_TICK_MS;
    this.spiderCenter = { ...point };
    const initialHalfTraverse = Math.max(4, size * 0.22);
    this.spiderProgress = [0, initialHalfTraverse];
    this.spiderProgressTime = time;
    this.buffer = new Float32Array(0);
    this.filter = new PointerFilter(smoothing);
    // Calligraphy's narrow axis is only 18% of its diameter and its dabs fade
    // at the edge, so keep their centers close enough for consistent overlap.
    // A subpixel floor avoids a 1 px gap when the nib is at minimum size.
    // Standard Spray keeps its original spacing.
    const spacing = nozzle === 'calligraphy' ? Math.max(0.5, size * 0.045) : nozzle === 'spider' ? Math.max(0.5, size * 0.01) : Math.max(2, size * 0.14);
    this.interpolator = new StrokeInterpolator(spacing);
    this.lastRaw = { ...point };
    const filtered = this.filter.push(point, time);
    if (nozzle === 'spider') this.processSpiderPosition(filtered, time);
    else this.emit(this.interpolator.push(filtered));
  }

  move(point: Point, time: number): void {
    if (!this.active || !this.filter || !this.interpolator || !this.lastRaw) return;
    const filtered = this.filter.push(point, time);
    if (this.active.nozzle === 'spider') {
      const lastInput = this.spiderInputs.at(-1);
      if (lastInput && time < lastInput.time) return;
      if (lastInput && time === lastInput.time) lastInput.point = { ...filtered };
      else this.spiderInputs.push({ time, point: { ...filtered } });
      this.emitSpiderAt(time);
    } else this.emit(this.interpolator.push(filtered));
    this.lastRaw = { ...point };
  }

  /** Advance Spider on a fixed time grid, including while the pointer is still. */
  tick(time: number): void {
    if (!this.active || this.active.nozzle !== 'spider') return;
    this.emitSpiderAt(time);
  }

  end(time?: number): SprayStroke | null {
    if (!this.active || !this.filter || !this.interpolator) return null;
    if (this.active.nozzle === 'spider') {
      const endTime = Math.max(this.spiderSimulationTime, time ?? this.spiderInputs.at(-1)?.time ?? this.spiderSimulationTime);
      this.emitSpiderAt(endTime);
      if (endTime > this.spiderSimulationTime) this.processSpiderPosition(this.positionAt(endTime), endTime);
    }
    else {
      const endpoint = this.lastRaw ?? this.active.points.at(-1)!;
      const exactEndpoint = this.filter.flush(endpoint);
      this.emit([...this.interpolator.push(exactEndpoint), ...this.interpolator.finish(exactEndpoint)]);
    }
    const completed = this.active;
    completed.particles = this.buffer.slice(0, this.depositCount * PARTICLE_STRIDE);
    this.active = null;
    this.filter = null;
    this.interpolator = null;
    this.lastRaw = null;
    this.spiderCenter = null;
    this.spiderInputs = [];
    this.buffer = new Float32Array(0);
    this.depositCount = 0;
    this.onChange(completed, new Float32Array(0));
    return completed;
  }

  private emit(points: Point[]): void {
    if (!this.active || points.length === 0) return;
    const batchStart = this.depositCount * PARTICLE_STRIDE;
    const sampleLimit = this.active.nozzle === 'spider' ? Number.POSITIVE_INFINITY : MAX_SAMPLES_PER_STROKE;
    const acceptedPoints = points.slice(0, Math.max(0, sampleLimit - this.active.points.length));
    const acceptedDeposits = this.active.nozzle === 'spider'
      ? acceptedPoints
      : acceptedPoints.slice(0, Math.max(0, MAX_DEPOSITS_PER_STROKE - this.depositCount));
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

  /** Advance both paths on a fixed time grid, even while the nozzle is still. */
  private emitSpiderAt(time: number): void {
    if (!this.active || this.active.nozzle !== 'spider' || !Number.isFinite(time) || time < this.spiderSimulationTime) return;
    const batchStart = this.depositCount * PARTICLE_STRIDE;
    while (this.spiderNextTick <= time) {
      this.processSpiderPosition(this.positionAt(this.spiderNextTick), this.spiderNextTick, false);
      this.spiderNextTick += SPIDER_TICK_MS;
    }
    const batchEnd = this.depositCount * PARTICLE_STRIDE;
    if (batchEnd > batchStart) {
      this.active.particles = this.buffer.subarray(0, batchEnd);
      this.onChange(this.active, this.buffer.subarray(batchStart, batchEnd));
    }
    let keep = -1;
    for (let index = 0; index < this.spiderInputs.length; index++) if (this.spiderInputs[index].time <= this.spiderSimulationTime) keep = index;
    if (keep > 0) this.spiderInputs.splice(0, keep);
  }

  private positionAt(time: number): Point {
    if (this.spiderInputs.length === 0) return this.spiderCenter ?? { x: 0, y: 0 };
    let low = 0;
    let high = this.spiderInputs.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.spiderInputs[mid].time <= time) low = mid;
      else high = mid - 1;
    }
    const before = this.spiderInputs[low];
    const after = this.spiderInputs[low + 1];
    if (!after || time <= before.time || after.time <= before.time) return { ...before.point };
    const t = Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
    return { x: before.point.x + (after.point.x - before.point.x) * t, y: before.point.y + (after.point.y - before.point.y) * t };
  }

  private processSpiderPosition(point: Point, time: number, notify = true): void {
    if (!this.active || !this.spiderCenter) return;
    const start = this.spiderCenter;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const distance = Math.hypot(dx, dy);
    const spacing = Math.max(0.5, this.active.size * 0.01);
    const fromTime = this.spiderSimulationTime;
    const spatialSteps = Math.ceil(distance / spacing);
    // Subdivide geometry inside the unchanged 16 ms simulation tick as weaving
    // speeds up, so neighboring filament quads still overlap at every rate.
    const weaveSteps = Math.ceil((time - fromTime) / SPIDER_TICK_MS * this.active.weaveFrequency);
    const steps = Math.max(1, spatialSteps, weaveSteps);
    const batchStart = this.depositCount * PARTICLE_STRIDE;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      this.depositSpiderSample({ x: start.x + dx * t, y: start.y + dy * t }, fromTime + (time - fromTime) * t);
    }
    this.spiderCenter = { ...point };
    this.spiderSimulationTime = time;
    const batchEnd = this.depositCount * PARTICLE_STRIDE;
    this.active.particles = this.buffer.subarray(0, batchEnd);
    if (notify) this.onChange(this.active, this.buffer.subarray(batchStart, batchEnd));
  }

  private depositSpiderSample(point: Point, time: number): void {
    const stroke = this.active!;
    const elapsed = Math.max(0, time - this.spiderProgressTime) / 1000;
    this.spiderProgress[0] += elapsed * stroke.size * 0.75 * stroke.weaveFrequency;
    this.spiderProgress[1] += elapsed * stroke.size * 0.63 * stroke.weaveFrequency;
    this.spiderProgressTime = time;
    const angle = stroke.rotation * Math.PI / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const halfTraverse = Math.max(4, stroke.size * 0.22);
    const hash = (n: number, filament: number): number => {
      const v = Math.sin((n + 17 + filament * 13) * 127.1 + 311.7 + filament * 91.9) * 43758.5453;
      return (v - Math.floor(v)) * 2 - 1;
    };
    for (let filament = 0; filament < 2; filament++) {
      const progress = this.spiderProgress[filament];
      const phase = progress / halfTraverse;
      const traverse = Math.floor(phase);
      const t = phase - traverse;
      const eased = t * t * (3 - 2 * t);
      const direction = traverse % 2 === 0 ? 1 : -1;
      const lateral = (-1 + 2 * eased) * direction * stroke.size * 0.46;
      const longitudinal = (hash(traverse, filament) * (1 - eased) + hash(traverse + 1, filament) * eased) * stroke.size * (filament === 0 ? 0.2 : 0.16);
      const x = point.x + lateral * c - longitudinal * s;
      const y = point.y + lateral * s + longitudinal * c;
      const previous = this.spiderPreviousFilaments[filament];
      const filamentAngle = previous ? Math.atan2(y - previous.y, x - previous.x) - angle : 0;
      this.pushParticle(x, y, filamentAngle, filament === 0 ? 1 : 0.72);
      this.active!.points.push({ ...point });
      this.active!.timeline.push({ time, point: { ...point }, filament, weaveFrequency: stroke.weaveFrequency });
      this.spiderPreviousFilaments[filament] = { x, y };
    }
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
