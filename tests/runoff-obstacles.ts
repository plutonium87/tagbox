import { RunoffEngine, type RunoffObstacle } from '../src/runoff';
import { ensureSurfaceLoaded, getSurfaceObstacles } from '../src/surfaces';
import type { Dab, Stroke } from '../src/settings';

const result = document.querySelector<HTMLElement>('#result')!;
const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };

function makeStroke(y = 500): Stroke {
  const dabs: Dab[] = Array.from({ length: 141 }, (_, index) => ({
    x: 220 + index * 10, y, size: 50, color: '#ff4d29', load: 1, paintLoad: 1,
    speed: 0, velocity: 0, angle: 0,
  }));
  return { points: [{ x: 220, y }, { x: 1620, y }], dabs, size: 50, color: '#ff4d29', material: 'paint', shape: 'round', rotation: 0 };
}

function maxRunoffY(engine: RunoffEngine, stroke: Stroke, inside?: RunoffObstacle): number {
  let maxY = -Infinity;
  engine.forEachGeometry(stroke, (_component, geometry) => {
    for (let i = 0; i < geometry.length; i += 5) {
      const x = geometry[i], y = geometry[i + 1];
      if (!inside || (x >= inside.left && x <= inside.right)) maxY = Math.max(maxY, y);
    }
  });
  return maxY;
}

try {
  await ensureSurfaceLoaded('steel-gate');
  await new Promise<void>((resolve) => {
    const poll = (): void => {
      if (getSurfaceObstacles('steel-gate').length) resolve();
      else window.setTimeout(poll, 25);
    };
    poll();
  });

  const steel = getSurfaceObstacles('steel-gate');
  check(steel.length === 2, 'Steel gate assets did not provide both obstacle masks.');

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const threshold = steel.find((obstacle) => obstacle.top > 900)!;
    check(Boolean(threshold), 'Steel gate threshold mask was not found.');
    const gate = new RunoffEngine(); gate.setIntensity(1); gate.setObstacles([threshold]);
    const gateStroke = makeStroke(850);
    gate.addDabs(gateStroke, gateStroke.dabs, 1000, 1920, 1080);
    for (let i = 0; i < 120; i++) gate.advance(0.05);
    const gateMaxY = maxRunoffY(gate, gateStroke);
    check(gateMaxY > 850, 'Steel gate runoff did not generate geometry.');
    check(gateMaxY <= threshold.top + 0.05, `Runoff crossed the steel gate threshold: ${gateMaxY} > ${threshold.top}.`);
  } finally {
    Math.random = originalRandom;
  }

  result.dataset.state = 'passed';
  result.textContent = `PASS\nSteel gate threshold stops runoff at y=${steel.find((obstacle) => obstacle.top > 900)!.top.toFixed(1)} px.`;
} catch (error) {
  result.dataset.state = 'failed';
  result.textContent = `FAIL\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  throw error;
}
