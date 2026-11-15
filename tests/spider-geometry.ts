import { SprayEngine, SPIDER_WEAVE_FREQUENCY } from '../src/spray';
import { clampSpiderWeaveSpeed, DEFAULT_SPIDER_WEAVE_SPEED, MAX_SPIDER_WEAVE_SPEED, MIN_SPIDER_WEAVE_SPEED, restoreSpiderWeaveSpeed, type Point, type SprayStroke } from '../src/settings';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runStroke(input: Point[], size = 100, pressure = 0.7, rotation = 37, duration = 640, frequency = SPIDER_WEAVE_FREQUENCY): { points: Point[]; particles: Float32Array; timeline: SprayStroke['timeline']; weaveFrequency: number } {
  let result: ReturnType<SprayEngine['end']> = null;
  const engine = new SprayEngine(() => {}, frequency);
  engine.begin(input[0], 0, size, '#ffffff', 0, pressure, 'paint', 'spider', rotation);
  for (let i = 1; i < input.length; i++) engine.move(input[i], duration * i / (input.length - 1));
  result = engine.end(duration);
  assert(result, 'Spider stroke should complete');
  return { points: result.points, particles: result.particles, timeline: result.timeline, weaveFrequency: result.weaveFrequency };
}

const sparse = runStroke([{ x: 10, y: 20 }, { x: 410, y: 20 }]);
const denseInput = Array.from({ length: 41 }, (_, index) => ({ x: 10 + index * 10, y: 20 }));
const dense = runStroke(denseInput);
assert(Math.abs(sparse.particles.length - dense.particles.length) / sparse.particles.length < 0.02, 'Distance resampling should remain consistent across input event frequency');
const replay = runStroke([{ x: 10, y: 20 }, { x: 410, y: 20 }]);
assert(sparse.particles.length === replay.particles.length, 'Replay particle count should match');
for (let i = 0; i < sparse.particles.length; i++) assert(sparse.particles[i] === replay.particles[i], 'Replay must be deterministic');

const rotation = 37 * Math.PI / 180;
const c = Math.cos(rotation);
const s = Math.sin(rotation);
let lateralMin = Infinity;
let lateralMax = -Infinity;
let longitudinalMin = Infinity;
let longitudinalMax = -Infinity;
for (let i = 0; i < sparse.points.length; i++) {
  const dx = sparse.particles[i * 4] - sparse.points[i].x;
  const dy = sparse.particles[i * 4 + 1] - sparse.points[i].y;
  const lateral = dx * c + dy * s;
  const longitudinal = -dx * s + dy * c;
  lateralMin = Math.min(lateralMin, lateral);
  lateralMax = Math.max(lateralMax, lateral);
  longitudinalMin = Math.min(longitudinalMin, longitudinal);
  longitudinalMax = Math.max(longitudinalMax, longitudinal);
  assert(Number.isFinite(sparse.particles[i * 4 + 2]), 'Segment angle must be finite');
}
assert(lateralMin >= -46.1 && lateralMax <= 46.1, 'Filament must remain inside lateral bounds');
assert(longitudinalMin >= -20.1 && longitudinalMax <= 20.1, 'Filament must remain inside longitudinal bounds');
assert(lateralMax - lateralMin > 80, 'Filament must traverse most of the nozzle width');

const stationaryEngine = new SprayEngine(() => {}, 10);
stationaryEngine.begin({ x: 300, y: 300 }, 0, 100, '#ffffff', 0, 0.8, 'paint', 'spider', 0);
stationaryEngine.tick(320);
const stationary = stationaryEngine.end(320)!;
assert(stationary.timeline.length > 20, 'Stationary time must produce repeated deposition');
const filamentA = stationary.timeline.filter((sample) => sample.filament === 0);
const filamentB = stationary.timeline.filter((sample) => sample.filament === 1);
assert(filamentA.length > 10 && filamentB.length > 10, 'Both filaments must deposit while stationary');
const indicesA = stationary.timeline.map((sample, index) => sample.filament === 0 ? index : -1).filter((index) => index >= 0);
const indicesB = stationary.timeline.map((sample, index) => sample.filament === 1 ? index : -1).filter((index) => index >= 0);
const firstA = stationary.particles[indicesA[0] * 4];
const firstB = stationary.particles[indicesB[0] * 4];
assert((firstA - 300) * (firstB - 300) < 0, 'Filaments should begin on opposite lateral sides');
assert(Math.abs(stationary.particles[indicesA.at(-1)! * 4] - firstA) > 20, 'Filament A should advance while stationary');
assert(Math.abs(stationary.particles[indicesB.at(-1)! * 4] - firstB) > 20, 'Filament B should advance independently');
assert(stationary.particles[indicesB[0] * 4 + 3] < stationary.particles[indicesA[0] * 4 + 3], 'Filament B should use a thinner width factor');
let closest = Infinity;
for (const aIndex of indicesA) for (const bIndex of indicesB) {
  closest = Math.min(closest, Math.hypot(stationary.particles[aIndex * 4] - stationary.particles[bIndex * 4], stationary.particles[aIndex * 4 + 1] - stationary.particles[bIndex * 4 + 1]));
}
assert(closest < 20, 'Independent paths should cross or overlap');
for (const filament of [0, 1]) {
  let previousIndex = -1;
  for (let index = 0; index < stationary.timeline.length; index++) {
    if (stationary.timeline[index].filament !== filament) continue;
    if (previousIndex >= 0) {
      const gap = Math.hypot(stationary.particles[index * 4] - stationary.particles[previousIndex * 4], stationary.particles[index * 4 + 1] - stationary.particles[previousIndex * 4 + 1]);
      assert(gap <= 9.1, 'Each time-sampled filament must remain connected by overlapping segment geometry');
    }
    previousIndex = index;
  }
}
const stationaryReplayEngine = new SprayEngine(() => {}, 10);
stationaryReplayEngine.begin({ x: 300, y: 300 }, 0, 100, '#ffffff', 0, 0.8, 'paint', 'spider', 0);
stationaryReplayEngine.tick(320);
const stationaryReplay = stationaryReplayEngine.end(320)!;
assert(stationaryReplay.particles.length === stationary.particles.length, 'Stationary replay particle count should match');
for (let i = 0; i < stationary.particles.length; i++) assert(stationaryReplay.particles[i] === stationary.particles[i], 'Stationary replay must be deterministic');

function runPauseAndMove(): SprayStroke {
  const engine = new SprayEngine(() => {});
  engine.begin({ x: 300, y: 300 }, 0, 100, '#ffffff', 0, 0.8, 'paint', 'spider', 25);
  engine.tick(160);
  engine.move({ x: 360, y: 320 }, 320);
  engine.tick(480);
  engine.move({ x: 360, y: 320 }, 640);
  return engine.end(640)!;
}
const pauseAndMove = runPauseAndMove();
const pauseAndMoveReplay = runPauseAndMove();
assert(pauseAndMove.timeline.length > 40, 'Stationary, moving, and stopped intervals should all deposit');
assert(pauseAndMove.timeline.some((sample) => sample.time >= 160 && sample.time <= 320), 'Initial stationary hold should be represented in timed geometry');
assert(pauseAndMove.timeline.some((sample) => sample.time >= 320 && sample.time <= 480), 'Movement should preserve ongoing filament phase');
assert(pauseAndMove.timeline.some((sample) => sample.time >= 480), 'Later stationary hold should continue deposition');
assert(pauseAndMove.particles.length === pauseAndMoveReplay.particles.length, 'Pause and movement replay count should match');
for (let i = 0; i < pauseAndMove.particles.length; i++) assert(pauseAndMove.particles[i] === pauseAndMoveReplay.particles[i], 'Pause and movement replay should be deterministic');

const existingAtFive = stationaryFrequencyRun(5);
const newAtTwenty = stationaryFrequencyRun(20);
assert(existingAtFive.weaveFrequency === 5 && newAtTwenty.weaveFrequency === 20, 'Frequency selection should apply to each new stroke without changing existing stroke settings');

for (const size of [3, 240]) {
  for (const pressure of [0, 1]) {
    for (const [dx, dy, rotation] of [[300, 0, 0], [0, 300, 90], [210, 210, 37]] as const) {
      const input = [{ x: 300, y: 300 }, { x: 300 + dx, y: 300 + dy }];
      const first = runStroke(input, size, pressure, rotation);
      const second = runStroke(input, size, pressure, rotation);
      assert(first.particles.length > 0 && first.particles.length === second.particles.length, 'All size, pressure, direction and rotation cases should deposit deterministically');
      for (let i = 0; i < first.particles.length; i++) {
        assert(Number.isFinite(first.particles[i]), 'Geometry coordinates and segment data must remain finite');
        assert(first.particles[i] === second.particles[i], 'Geometry replay must be stable across parameter combinations');
      }
    }
  }
}

function stationaryFrequencyRun(frequency: number): SprayStroke {
  const engine = new SprayEngine(() => {}, frequency);
  engine.begin({ x: 300, y: 300 }, 0, 100, '#ffffff', 0, 0.8, 'paint', 'spider', 0);
  engine.tick(320);
  return engine.end(320)!;
}
function countReversals(stroke: SprayStroke, filament: number): number {
  const values = stroke.timeline.map((sample, index) => sample.filament === filament ? stroke.particles[index * 4] : null).filter((value): value is number => value !== null);
  let direction = 0;
  let reversals = 0;
  for (let i = 1; i < values.length; i++) {
    const next = Math.sign(values[i] - values[i - 1]);
    if (next && direction && next !== direction) reversals++;
    if (next) direction = next;
  }
  return reversals;
}
const testedSpeeds = [MIN_SPIDER_WEAVE_SPEED, 10, DEFAULT_SPIDER_WEAVE_SPEED, 35, MAX_SPIDER_WEAVE_SPEED];
const frequencyRuns = testedSpeeds.map(stationaryFrequencyRun);
const reversalCounts = frequencyRuns.map((stroke) => countReversals(stroke, 0));
assert(SPIDER_WEAVE_FREQUENCY === 20 && DEFAULT_SPIDER_WEAVE_SPEED === 20, 'Default weaving speed should be 20x');
assert(clampSpiderWeaveSpeed(2) === MIN_SPIDER_WEAVE_SPEED && clampSpiderWeaveSpeed(51) === MAX_SPIDER_WEAVE_SPEED, 'Persisted out-of-range speeds should migrate to the new limits');
assert(restoreSpiderWeaveSpeed('2') === 5 && restoreSpiderWeaveSpeed('51') === 50, 'Persisted old-range values should restore inside the new range');
assert(restoreSpiderWeaveSpeed('20') === DEFAULT_SPIDER_WEAVE_SPEED && restoreSpiderWeaveSpeed(null) === DEFAULT_SPIDER_WEAVE_SPEED, 'Persisted and missing default values should restore correctly');
assert(clampSpiderWeaveSpeed(7.5) === 8, 'Weave speed should normalize to whole-number increments');
assert(reversalCounts.every((count, index) => index === 0 || count > reversalCounts[index - 1]), 'Both paths should increase traversal frequency with the control value');
assert(reversalCounts[2] >= 19, 'Default 20x should produce about twenty Filament A traversals');
const filamentBReversals = frequencyRuns.map((stroke) => countReversals(stroke, 1));
assert(filamentBReversals[2] >= 16, 'Default 20x should preserve Filament B’s independent progression rate');
for (const [runIndex, frequency] of testedSpeeds.entries()) {
  const stroke = frequencyRuns[runIndex];
  assert(stroke.weaveFrequency === frequency, 'Completed stroke should retain its selected weave speed for replay');
  const replay = stationaryFrequencyRun(frequency);
  assert(stroke.particles.length === replay.particles.length, 'Frequency replay should retain its geometry count');
  for (let i = 0; i < stroke.particles.length; i++) assert(stroke.particles[i] === replay.particles[i], 'Frequency replay should be deterministic');
  for (const filament of [0, 1]) {
    let previousIndex = -1;
    for (let index = 0; index < stroke.timeline.length; index++) {
      if (stroke.timeline[index].filament !== filament) continue;
      if (previousIndex >= 0) {
        const gap = Math.hypot(stroke.particles[index * 4] - stroke.particles[previousIndex * 4], stroke.particles[index * 4 + 1] - stroke.particles[previousIndex * 4 + 1]);
        assert(gap <= 9.1, `Frequency ${frequency} must preserve connected segment overlap`);
      }
      previousIndex = index;
    }
  }
  const moving = runStroke([{ x: 100, y: 100 }, { x: 500, y: 100 }], 100, 0.8, 0, 320, frequency);
  for (const filament of [0, 1]) {
    let previousIndex = -1;
    for (let index = 0; index < moving.timeline.length; index++) {
      if (moving.timeline[index].filament !== filament) continue;
      if (previousIndex >= 0) {
        const gap = Math.hypot(moving.particles[index * 4] - moving.particles[previousIndex * 4], moving.particles[index * 4 + 1] - moving.particles[previousIndex * 4 + 1]);
        assert(gap <= 9.1, `Moving geometry should remain continuous at ${frequency}x`);
      }
      previousIndex = index;
    }
  }
}
console.log('Spider geometry checks passed');
