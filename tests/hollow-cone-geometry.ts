import { HOLLOW_CONE_CENTER_STRENGTH, hollowConeExposure, hollowConeOrganicVariation, hollowConeRadialDensity, hollowConeRingWidth, SprayEngine } from '../src/spray';
import type { Point, SprayStroke } from '../src/settings';
import { restoreSprayNozzle, spraySettings } from '../src/settings';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(spraySettings.nozzle === 'hollow-cone', 'New installations should default to Hollow Cone.');
assert(restoreSprayNozzle('standard') === 'hollow-cone', 'Previously saved Standard selections should migrate to Hollow Cone.');
assert(restoreSprayNozzle('hollow-cone') === 'hollow-cone', 'Saved Hollow Cone selections should remain unchanged.');
assert(restoreSprayNozzle('calligraphy') === 'calligraphy', 'Saved Calligraphy selections should remain unchanged.');
assert(restoreSprayNozzle('spider') === 'spider', 'Saved Spider selections should remain unchanged.');
assert(restoreSprayNozzle(null) === 'hollow-cone', 'Missing nozzle preferences should use the Hollow Cone default.');

function runPath(eventCount: number, duration: number, cancel = false, size = 96, pressure = 0.72): SprayStroke | null {
  const engine = new SprayEngine(() => {});
  engine.begin({ x: 40, y: 80 }, 0, size, '#fff', 0, pressure, 'paint', 'hollow-cone');
  for (let index = 1; index <= eventCount; index++) {
    const t = duration * index / eventCount;
    engine.move({ x: 40 + 240 * index / eventCount, y: 80 }, t);
  }
  if (cancel) {
    engine.cancel();
    engine.tick(duration + 320);
    assert(engine.end(duration + 320) === null, 'Cancelled stroke must not leave a live simulation');
    return null;
  }
  return engine.end(duration)!;
}

const stillEngine = new SprayEngine(() => {});
stillEngine.begin({ x: 200, y: 200 }, 10, 96, '#fff', 0, 0.72, 'paint', 'hollow-cone');
stillEngine.tick(170);
const stationary = stillEngine.end(170)!;
assert(stationary.timeline.length === 10, 'A stationary hold should deposit on the fixed 16 ms grid');
assert(stationary.timeline.every((sample) => sample.point.x === 200 && sample.deposition === hollowConeExposure(0.72, 96, 0)), 'Stationary samples should accumulate at one point with calibrated exposure');
assert(stationary.timeline.every((sample, index) => sample.time === 26 + index * 16), 'Stationary sampling timestamps should remain fixed');
stillEngine.tick(400);
assert(stationary.particles.length === 40, 'Finishing a stroke must stop its time sampler');

function pauseMovePause(): SprayStroke {
  let emptyUpdates = 0;
  const engine = new SprayEngine((_stroke, particles) => { if (!particles.length) emptyUpdates++; });
  engine.begin({ x: 100, y: 120 }, 0, 96, '#fff', 0, 0.72, 'paint', 'hollow-cone');
  engine.tick(96);
  engine.move({ x: 100, y: 120 }, 96);
  engine.move({ x: 160, y: 120 }, 192);
  engine.tick(288);
  engine.move({ x: 160, y: 120 }, 384);
  engine.move({ x: 220, y: 120 }, 480);
  engine.tick(576);
  engine.move({ x: 220, y: 120 }, 672);
  const stroke = engine.end(688)!;
  assert(emptyUpdates === 1, 'Pointer transitions should not trigger full-stroke replay resets');
  return stroke;
}
const transition = pauseMovePause();
assert(transition.timeline.some((sample) => sample.speed === 0 && sample.time < 96), 'Initial stationary deposition should continue before movement');
assert(transition.timeline.some((sample) => sample.speed! > 0 && sample.time >= 96 && sample.time <= 192), 'Movement should continue the same time grid and record speed');
const movingSample = transition.timeline.find((sample) => sample.time === 208)!;
assert(transition.timeline.at(-1)!.speed! < movingSample.speed!, 'Returning to stationary input should smoothly reduce the filtered speed');
assert(transition.timeline.at(-1)!.deposition! > movingSample.deposition!, 'Deposition should recover as the pointer slows to a stop');
assert(transition.timeline.some((sample) => sample.speed! > 0 && sample.time >= 384 && sample.time <= 480), 'Movement should resume within the same active stroke');
const transitionTimes = [...new Set(transition.timeline.map((sample) => sample.time))];
assert(transitionTimes.every((time, index) => index === 0 || time - transitionTimes[index - 1] === 16), 'Stationary and moving phases should share one uninterrupted time grid');
assert(transition.timeline.every((sample, index) => index === 0 || sample.phase! > transition.timeline[index - 1].phase!), 'Movement transitions must not reset procedural phase');

const slow = runPath(8, 1200)!;
const fast = runPath(8, 240)!;
const pathDose = (stroke: SprayStroke): number => stroke.timeline.reduce((sum, sample) => sum + (sample.deposition ?? 0), 0) * stroke.size ** 2 / 240;
assert(pathDose(slow) > pathDose(fast) * 1.15, 'Slow movement should deposit more pigment per unit of path than fast movement');
assert(hollowConeExposure(1, 96, 350) > 0.8, 'Full pressure should produce practical exposure at normal painting speeds');
assert(hollowConeExposure(1, 96, 350) > hollowConeExposure(0.5, 96, 350) * 1.7, 'Full pressure should accumulate substantially faster than half pressure');
assert(hollowConeExposure(0.5, 96, 350) > 0.35, 'Half pressure should retain practical accumulation at normal speeds');
assert(hollowConeExposure(0.1, 96, 350) < hollowConeExposure(0.5, 96, 350), 'Low pressure should remain lighter');
assert(hollowConeExposure(0.7, 24, 350) > hollowConeExposure(0.7, 192, 350) * 2, 'Small Spray Size should accumulate faster than large Spray Size');
for (const size of [3, 18, 86, 240]) {
  for (const speed of [0, 350, 900]) {
    const halfPressure = hollowConeExposure(0.5, size, speed);
    const fullPressure = hollowConeExposure(1, size, speed);
    assert(fullPressure > halfPressure * 1.5, `100% Pressure should remain stronger than 50% at size ${size}, speed ${speed}`);
  }
}
assert(hollowConeExposure(1, 3, 900) > hollowConeExposure(0.5, 3, 900) * 1.5, 'Minimum Size should become denser at full Pressure even at fast speed');
assert(hollowConeExposure(1, 3, 900) < hollowConeExposure(1, 3, 100), 'Fast movement should continue reducing minimum-size deposition');
assert(hollowConeExposure(1, 3, 0) === 2, 'The small-size full-pressure stationary exposure should remain capped as before');
assert(hollowConeExposure(1, 240, 350) < 1.1, 'Maximum Size should retain broad deposition without excessive opacity');
for (const size of [24, 96, 192]) {
  assert(hollowConeExposure(0.6, size, 100) > hollowConeExposure(0.6, size, 900), 'Movement speed should remain influential at every Spray Size');
  assert(hollowConeExposure(1, size, 100) > hollowConeExposure(1, size, 900), 'Speed response should remain visible at full Pressure');
  assert(hollowConeExposure(0.5, size, 100) > hollowConeExposure(0.5, size, 900), 'Speed response should remain visible at half Pressure');
  assert(hollowConeExposure(0.7, size, 0) > hollowConeExposure(0.2, size, 0), 'Stationary deposition should respond to Pressure');
}

const slowRing = hollowConeRadialDensity(0.7, 0.72, 1);
const fastRing = hollowConeRadialDensity(0.7, 0.72, 0.2);
assert(slowRing > fastRing * 3, 'The outer ring should be less prominent at high speed');
assert(hollowConeRadialDensity(0.7, 1, 1) > hollowConeRadialDensity(0.7, 0.2, 1), 'Pressure should remain the primary control for ring intensity');
assert(hollowConeRadialDensity(0.7, 1, 0.2) < hollowConeRadialDensity(0.7, 0.2, 1), 'High movement speed should still weaken a high-pressure ring');
assert(hollowConeRadialDensity(0, 0.72, 1) >= slowRing * 0.85, 'Central peak should initially approach the outer ring peak');
assert(hollowConeRadialDensity(0.35, 0.72, 1) < slowRing * 0.8, 'The inner region should remain weaker than the two peaks');
const minSizeStroke = runPath(2, 240, false, 3, 1)!;
const maxSizeStroke = runPath(2, 240, false, 240, 1)!;
assert(minSizeStroke.timeline[0].deposition! > maxSizeStroke.timeline[0].deposition! * 2, 'Minimum size should retain stronger per-sample concentration');
assert(maxSizeStroke.size > minSizeStroke.size && maxSizeStroke.size / minSizeStroke.size === 80, 'Maximum size should retain a much broader spatial footprint');
assert(hollowConeRingWidth(240, 1, maxSizeStroke.timeline[0].deposition!) > hollowConeRingWidth(3, 1, minSizeStroke.timeline[0].deposition!), 'Large sizes should retain a physically broader ring');
assert(hollowConeRadialDensity(0.7, 1, minSizeStroke.timeline[0].deposition!) > hollowConeRadialDensity(0.7, 1, maxSizeStroke.timeline[0].deposition!), 'Small sizes should have stronger local ring concentration');
assert(HOLLOW_CONE_CENTER_STRENGTH > 0, 'Central deposition should remain independently adjustable in the model');
for (const phase of [0, 0.37, 18.5, 7400]) {
  const first = hollowConeOrganicVariation(0.8, phase, 2.1);
  const replay = hollowConeOrganicVariation(0.8, phase, 2.1);
  assert(JSON.stringify(first) === JSON.stringify(replay), 'Organic variation should be deterministic');
  assert(Math.hypot(first.centerX, first.centerY) <= 0.018, 'Central drift should stay within its bounded radius');
  assert(Math.abs(first.ringRadiusOffset) <= 0.018 && first.ringIntensity >= 0.86 && first.ringIntensity <= 1, 'Ring irregularity should remain restrained');
}
const variationA = hollowConeOrganicVariation(0.2, 10, 1.4);
const variationB = hollowConeOrganicVariation(0.2, 10.37, 1.4);
assert(Math.hypot(variationB.centerX - variationA.centerX, variationB.centerY - variationA.centerY) < 0.002, 'Center drift should evolve without sample-to-sample jumps');
for (const p of [0.1, 0.5, 1]) {
  for (const d of [0.2, 1]) {
    for (const radius of [0, 0.1, 0.35, 0.7, 0.9, 1]) {
      const density = hollowConeRadialDensity(radius, p, d);
      assert(density === hollowConeRadialDensity(radius, p, d), 'Radial deposition must be deterministic and symmetric');
      assert(density >= 0 && density <= 1, 'Radial deposition must remain bounded');
    }
    assert(hollowConeRadialDensity(1.01, p, d) === 0, 'The footprint must remain circularly bounded');
  }
}

const sparse = runPath(2, 640)!;
const dense = runPath(40, 640)!;
assert(sparse.particles.length === dense.particles.length, 'Different pointer event frequencies should produce the same fixed-grid sample count');
for (let i = 0; i < sparse.particles.length; i++) assert(sparse.particles[i] === dense.particles[i], 'Linear path replay should be independent of pointer event frequency');
const replay = runPath(40, 640)!;
assert(dense.hollowSeed === replay.hollowSeed, 'Identical strokes should retain the same deterministic organic seed');
for (let i = 0; i < dense.particles.length; i++) assert(dense.particles[i] === replay.particles[i], 'Replay must preserve deterministic particles and speed response');
assert(dense.timeline.every((sample, index) => index === 0 || Math.abs(Math.abs(sample.phase! - dense.timeline[index - 1].phase!) - 0.37) < 1e-6), 'Procedural phase should advance smoothly without flicker');
for (const size of [3, 18, 86, 240]) {
  const fastStroke = runPath(2, 240, false, size, 1)!;
  for (let index = 1; index < fastStroke.points.length; index++) {
    const gap = Math.hypot(fastStroke.points[index].x - fastStroke.points[index - 1].x, fastStroke.points[index].y - fastStroke.points[index - 1].y);
    assert(gap <= 2 + 1e-4, `Size ${size} should remain spatially continuous at high speed`);
  }
}
const repeatPass = hollowConeRadialDensity(0.7, 0.5, hollowConeExposure(0.5, 96, 350));
const afterFourPasses = 1 - Math.pow(1 - repeatPass, 4);
assert(afterFourPasses > repeatPass, 'Repeated passes should accumulate paint naturally');

{
  const engine = new SprayEngine(() => {});
  engine.begin({ x: 40, y: 80 }, 0, 96, '#fff', 0, 0.72, 'paint', 'standard');
  engine.move({ x: 120, y: 80 }, 100);
  const stroke = engine.end(100)!;
  assert(stroke.nozzle === 'hollow-cone' && stroke.timeline.some((sample) => sample.deposition !== undefined), 'Legacy Standard strokes must use Hollow Cone sampling.');
}
{
  const engine = new SprayEngine(() => {});
  engine.begin({ x: 40, y: 80 }, 0, 96, '#fff', 0, 0.72, 'paint', 'calligraphy');
  engine.move({ x: 120, y: 80 }, 100);
  const stroke = engine.end(100)!;
  assert(stroke.nozzle === 'calligraphy' && stroke.timeline.every((sample) => sample.deposition === undefined && sample.phase === undefined), 'Calligraphy must retain its existing sampling behavior.');
}

const cancelled = runPath(10, 400, true);
assert(cancelled === null, 'Cancelled strokes should not produce a committed result');
const afterCancel = runPath(10, 400)!;
assert(afterCancel.timeline.length > 0, 'A fresh stroke should work after cancellation cleanup');
assert(afterCancel.points.every((point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y)), 'Sample coordinates should stay finite');
