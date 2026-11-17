import { PointerFilter, StrokeInterpolator } from './smoothing';
import { DEFAULT_SPIDER_WEAVE_RATE, clampSpiderWeaveRate, type Material, type Point, type SprayNozzle, type SprayStroke } from './settings';

const PARTICLE_STRIDE = 4;
const MAX_SAMPLES_PER_STROKE = 20_000;
const MAX_DEPOSITS_PER_STROKE = 20_000;
const MAX_HOLLOW_DEPOSITS_PER_STROKE = 100_000;
const SPIDER_TICK_MS = 16;
const HOLLOW_CONE_TICK_MS = 16;
const HOLLOW_SPEED_SCALE = 850;
const HOLLOW_SPATIAL_STEP = 2;
const HOLLOW_STATIONARY_DELAY_MS = 80;
const HOLLOW_SPEED_FILTER_MS = 72;
const HOLLOW_DOSE_FILTER_MS = 96;
const HOLLOW_STILL_DISTANCE = 0.08;
export const HOLLOW_CONE_CENTER_STRENGTH = 1;

export function hollowConeExposure(pressure: number, size: number, speed: number): number {
  const p = Math.max(0, Math.min(1, pressure));
  const pressureRate = 0.35 + 1.0 * Math.pow(p, 1.8);
  const sizeRate = Math.max(0.62, Math.min(1.75, Math.sqrt(96 / Math.max(3, size))));
  const smallSizeWeight = 1 - smoothstep(3, 86, size);
  const smallSizeBoost = 1 + 0.15 * p * p * smallSizeWeight;
  const movingCoverage = speed > 0 ? 1 + 0.18 * Math.pow(p, 3) * speed / (speed + 300) : 1;
  return Math.max(0.02, Math.min(2, pressureRate * sizeRate * smallSizeBoost * hollowConeSpeedRate(speed) * movingCoverage));
}

export function hollowConeSpeedRate(speed: number): number {
  return 0.3 + 0.7 / (1 + Math.pow(Math.max(0, speed) / HOLLOW_SPEED_SCALE, 1.1));
}

export function hollowConeRingWidth(size: number, pressure: number, deposition: number): number {
  const p = Math.max(0, Math.min(1, pressure));
  const d = Math.max(0, Math.min(2, deposition));
  return size * (0.055 + 0.085 * p) * (0.68 + 0.32 * d);
}

export function hollowConeOrganicVariation(angle: number, phase: number, seed: number): { centerX: number; centerY: number; ringRadiusOffset: number; ringIntensity: number } {
  return {
    centerX: Math.sin(phase * 0.18 + seed) * 0.0127,
    centerY: Math.cos(phase * 0.14 + seed * 1.7) * 0.0127,
    ringRadiusOffset: Math.sin(angle * 3 + phase * 0.15 + seed) * 0.012 + Math.sin(angle * 5 - phase * 0.09 + seed * 2) * 0.006,
    ringIntensity: 0.93 + 0.045 * Math.sin(angle * 4 + phase * 0.12 + seed) + 0.025 * Math.sin(angle * 7 - phase * 0.07 + seed * 2),
  };
}

export function hollowConeRadialDensity(radius: number, pressure: number, deposition: number, centerStrength = HOLLOW_CONE_CENTER_STRENGTH): number {
  if (radius < 0 || radius > 1) return 0;
  const p = Math.max(0, Math.min(1, pressure));
  const d = Math.max(0, Math.min(2, deposition));
  const ringRadius = 0.7;
  const ringWidth = (0.055 + (0.14 - 0.055) * p) * (0.68 + 0.32 * d);
  const ring = Math.exp(-(((radius - ringRadius) / ringWidth) ** 2) * 1.7);
  const glow = Math.exp(-(((radius - ringRadius) / (ringWidth * 2.15)) ** 2) * 1.35);
  const overspray = (1 - smoothstep(0.78, 1, radius)) * Math.exp(-Math.max(0, radius - 0.76) * 5);
  const ringBase = 0.06 + 0.78 * p;
  const glowBase = 0.025 + 0.19 * p;
  const center = Math.exp(-((radius / 0.24) ** 2) * 2) * centerStrength * (ringBase + glowBase) * Math.pow(d, 0.8);
  const innerFill = p * p * 0.2 * d * (1 - smoothstep(0.16, 0.68, radius));
  return Math.max(0, Math.min(1, ringBase * Math.pow(d, 1.45) * ring + glowBase * d * glow + 0.16 * p * d * overspray + center + innerFill));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
export const SPIDER_WEAVE_FREQUENCY = DEFAULT_SPIDER_WEAVE_RATE;

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
  private hollowInputs: Array<{ time: number; point: Point }> = [];
  private hollowSimulationTime = 0;
  private hollowNextTick = 0;
  private hollowCenter: Point | null = null;
  private hollowSpeed = 0;
  private hollowDose = 0;
  private hollowStationary = true;
  private hollowStillSince: number | null = null;

  constructor(
    private readonly onChange: (stroke: SprayStroke, newParticles: Float32Array) => void,
    private readonly defaultSpiderWeaveFrequency = SPIDER_WEAVE_FREQUENCY,
  ) {}

  begin(point: Point, time: number, size: number, color: string, smoothing: number, pressure: number, material: Material = 'paint', nozzle: SprayNozzle = 'standard', rotation = 0, weaveFrequency = this.defaultSpiderWeaveFrequency): void {
    // The old Standard identifier is retained for serialized stroke compatibility.
    if (nozzle === 'standard') nozzle = 'hollow-cone';
    const hollowSeed = nozzle === 'hollow-cone' ? seedHollowStroke(point, size, pressure) : 0;
    this.active = { kind: 'spray', points: [], particles: new Float32Array(0), timeline: [], size, color, pressure, material, nozzle, rotation, weaveFrequency: clampSpiderWeaveRate(weaveFrequency), ...(nozzle === 'hollow-cone' ? { hollowSeed } : {}) };
    this.depositCount = 0;
    this.spiderPreviousFilaments = [null, null];
    this.spiderInputs = [{ time, point: { ...point } }];
    this.spiderSimulationTime = time;
    this.spiderNextTick = time + SPIDER_TICK_MS;
    this.spiderCenter = { ...point };
    const initialHalfTraverse = Math.max(4, size * 0.22);
    this.spiderProgress = [0, initialHalfTraverse];
    this.spiderProgressTime = time;
    this.hollowInputs = [{ time, point: { ...point } }];
    this.hollowSimulationTime = time;
    this.hollowNextTick = time + HOLLOW_CONE_TICK_MS;
    this.hollowCenter = { ...point };
    this.hollowSpeed = 0;
    this.hollowDose = hollowConeExposure(pressure, size, 0);
    this.hollowStationary = true;
    this.hollowStillSince = null;
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
    else if (nozzle !== 'hollow-cone') this.emit(this.interpolator.push(filtered));
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
    } else if (this.active.nozzle === 'hollow-cone') {
      const lastInput = this.hollowInputs.at(-1);
      if (lastInput && time < lastInput.time) return;
      if (lastInput && time === lastInput.time) lastInput.point = { ...filtered };
      else this.hollowInputs.push({ time, point: { ...filtered } });
      this.emitHollowAt(Math.max(time, this.hollowSimulationTime));
    } else this.emit(this.interpolator.push(filtered));
    this.lastRaw = { ...point };
  }

  /** Advance Spider on a fixed time grid, including while the pointer is still. */
  tick(time: number): void {
    if (!this.active) return;
    if (this.active.nozzle === 'spider') this.emitSpiderAt(time);
    else if (this.active.nozzle === 'hollow-cone') this.emitHollowAt(time);
  }

  end(time?: number): SprayStroke | null {
    if (!this.active || !this.filter || !this.interpolator) return null;
    if (this.active.nozzle === 'spider') {
      const endTime = Math.max(this.spiderSimulationTime, time ?? this.spiderInputs.at(-1)?.time ?? this.spiderSimulationTime);
      this.emitSpiderAt(endTime);
      if (endTime > this.spiderSimulationTime) this.processSpiderPosition(this.positionAt(endTime), endTime);
    } else if (this.active.nozzle === 'hollow-cone') this.emitHollowAt(Math.max(this.hollowSimulationTime, time ?? this.hollowInputs.at(-1)?.time ?? this.hollowSimulationTime));
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
    this.hollowInputs = [];
    this.hollowCenter = null;
    this.hollowDose = 0;
    this.hollowSpeed = 0;
    this.hollowStillSince = null;
    this.buffer = new Float32Array(0);
    this.depositCount = 0;
    this.onChange(completed, new Float32Array(0));
    return completed;
  }

  cancel(): void {
    this.active = null;
    this.filter = null;
    this.interpolator = null;
    this.lastRaw = null;
    this.spiderCenter = null;
    this.spiderInputs = [];
    this.hollowCenter = null;
    this.hollowInputs = [];
    this.hollowDose = 0;
    this.hollowSpeed = 0;
    this.hollowStillSince = null;
    this.buffer = new Float32Array(0);
    this.depositCount = 0;
  }

  private emitHollowAt(time: number): void {
    if (!this.active || this.active.nozzle !== 'hollow-cone' || !Number.isFinite(time) || time < this.hollowSimulationTime || !this.hollowCenter) return;
    const batchStart = this.depositCount * PARTICLE_STRIDE;
    while (this.hollowNextTick <= time && this.depositCount < MAX_HOLLOW_DEPOSITS_PER_STROKE) {
      this.depositHollowSample(this.hollowNextTick);
    }
    const batchEnd = this.depositCount * PARTICLE_STRIDE;
    this.active.particles = this.buffer.subarray(0, batchEnd);
    if (batchEnd > batchStart) this.onChange(this.active, this.buffer.subarray(batchStart, batchEnd));
    let keep = -1;
    for (let index = 0; index < this.hollowInputs.length; index++) if (this.hollowInputs[index].time <= this.hollowSimulationTime) keep = index;
    if (keep > 0) this.hollowInputs.splice(0, keep);
  }

  private depositHollowSample(time: number): void {
    if (!this.active || !this.hollowCenter) return;
    const next = this.positionAtInputs(this.hollowInputs, time, this.hollowCenter);
    const elapsed = Math.max(1, time - this.hollowSimulationTime);
    const distance = Math.hypot(next.x - this.hollowCenter.x, next.y - this.hollowCenter.y);
    const rawSpeed = distance / elapsed * 1000;
    this.hollowSpeed += (rawSpeed - this.hollowSpeed) * (1 - Math.exp(-elapsed / HOLLOW_SPEED_FILTER_MS));
    if (distance > HOLLOW_STILL_DISTANCE) {
      this.hollowStationary = false;
      this.hollowStillSince = null;
    } else if (!this.hollowStationary) {
      this.hollowStillSince ??= this.hollowSimulationTime;
      if (time - this.hollowStillSince >= HOLLOW_STATIONARY_DELAY_MS) this.hollowStationary = true;
    }
    const targetDose = hollowConeExposure(this.active.pressure, this.active.size, this.hollowStationary ? 0 : this.hollowSpeed);
    this.hollowDose += (targetDose - this.hollowDose) * (1 - Math.exp(-elapsed / HOLLOW_DOSE_FILTER_MS));
    // Ignore subpixel jitter while movement is still active. A brief pause should
    // not turn into repeated dabs; stationary deposition begins after the hold delay.
    if (!this.hollowStationary && distance <= HOLLOW_STILL_DISTANCE) {
      this.hollowCenter = next;
      this.hollowSimulationTime = time;
      this.hollowNextTick = time + HOLLOW_CONE_TICK_MS;
      return;
    }
    const steps = Math.max(1, Math.ceil(distance / HOLLOW_SPATIAL_STEP));
    const deposition = this.hollowDose / steps;
    for (let step = 1; step <= steps && this.depositCount < MAX_HOLLOW_DEPOSITS_PER_STROKE; step++) {
      const t = step / steps;
      const point = { x: this.hollowCenter.x + (next.x - this.hollowCenter.x) * t, y: this.hollowCenter.y + (next.y - this.hollowCenter.y) * t };
      const sampleOrdinal = this.active.timeline.length + 1;
      const phase = sampleOrdinal * 0.37;
      this.active.points.push(point);
      this.active.timeline.push({ time, point, filament: 0, weaveFrequency: this.active.weaveFrequency, speed: this.hollowStationary ? 0 : this.hollowSpeed, deposition, phase });
      this.pushParticle(point.x, point.y, this.active.size + phase, deposition);
    }
    this.hollowCenter = next;
    this.hollowSimulationTime = time;
    this.hollowNextTick = time + HOLLOW_CONE_TICK_MS;
  }

  private positionAtInputs(inputs: Array<{ time: number; point: Point }>, time: number, fallback: Point): Point {
    if (!inputs.length) return { ...fallback };
    let low = 0;
    while (low + 1 < inputs.length && inputs[low + 1].time <= time) low++;
    const before = inputs[low];
    const after = inputs[low + 1];
    if (!after || after.time <= before.time || time <= before.time) return { ...before.point };
    const t = Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
    return { x: before.point.x + (after.point.x - before.point.x) * t, y: before.point.y + (after.point.y - before.point.y) * t };
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
    this.buffer[offset + 3] = Math.max(0, Math.min(this.active?.nozzle === 'hollow-cone' ? 2 : 1, opacity));
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return;
    const capacity = Math.max(required, this.buffer.length === 0 ? 256 : this.buffer.length * 2);
    const grown = new Float32Array(capacity);
    grown.set(this.buffer.subarray(0, this.depositCount * PARTICLE_STRIDE));
    this.buffer = grown;
  }

}

function seedHollowStroke(point: Point, size: number, pressure: number): number {
  const value = Math.sin(point.x * 12.9898 + point.y * 78.233 + size * 37.719 + pressure * 19.19) * 43758.5453;
  return (value - Math.floor(value)) * Math.PI * 2;
}
