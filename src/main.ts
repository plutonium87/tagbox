import './style.css';
import { AudioManager, CanShakeDetector, DEFAULT_AUDIO_PREFERENCES, type AudioPreferences } from './audio';
import { BrushEngine } from './brush';
import { timestampedExportFilename } from './export-filename';
import { SprayEngine } from './spray';
import { CanvasNavigation } from './navigation';
import { pointerPosition, CanvasRenderer } from './renderer';
import { drawForeground, drawSurface, getCustomSurfaces, getSurfaceAmbience, getSurfaceDimensions, getSurfaceEnvironmentParallax, getSurfaceNavigationBounds, getSurfaceObstacles, getSurfacePaintMask, type CanvasSurface } from './surfaces';
import { CANVAS_HEIGHT as DEFAULT_CANVAS_HEIGHT, CANVAS_WIDTH as DEFAULT_CANVAS_WIDTH, clampBrushSize, clampSpraySize, settings, spraySettings, type Material, type PaintOperation, type Point } from './settings';

const canvas = document.querySelector<HTMLCanvasElement>('#paint-canvas')!;
const runoffCanvas = document.querySelector<HTMLCanvasElement>('#runoff-canvas')!;
const backgroundCanvas = document.querySelector<HTMLCanvasElement>('#background-canvas')!;
const foregroundCanvas = document.querySelector<HTMLCanvasElement>('#foreground-canvas')!;
let CANVAS_WIDTH = DEFAULT_CANVAS_WIDTH;
let CANVAS_HEIGHT = DEFAULT_CANVAS_HEIGHT;
const renderer = new CanvasRenderer(canvas, runoffCanvas);
const navigation = new CanvasNavigation(CANVAS_WIDTH, CANVAS_HEIGHT);
document.querySelector<HTMLElement>('#brand-version')!.textContent = `v${__TAGBOX_VERSION__}`;
const operations: PaintOperation[] = [];
const brush = new BrushEngine((stroke, dabs) => renderer.setActive(stroke, dabs));
const spray = new SprayEngine((stroke, particles) => renderer.setActiveSpray(stroke, particles));
const sizeInput = document.querySelector<HTMLInputElement>('#brush-size')!;
const smoothingInput = document.querySelector<HTMLInputElement>('#smoothing')!;
const wetnessInput = document.querySelector<HTMLInputElement>('#wetness')!;
const intensityInput = document.querySelector<HTMLInputElement>('#run-intensity')!;
const splatterInput = document.querySelector<HTMLInputElement>('#paint-splatter')!;
const spraySizeInput = document.querySelector<HTMLInputElement>('#spray-size')!;
const sprayPressureInput = document.querySelector<HTMLInputElement>('#spray-pressure')!;
const spraySmoothingInput = document.querySelector<HTMLInputElement>('#spray-smoothing')!;
const sprayRotationGroup = document.querySelector<HTMLElement>('#spray-rotation-group')!;
const sprayRotationDial = document.querySelector<HTMLButtonElement>('#spray-rotation-dial')!;
const sprayRotationTip = sprayRotationDial.querySelector<HTMLElement>('.rotation-tip-preview')!;
const sprayRotationValue = document.querySelector<HTMLOutputElement>('#spray-rotation-value')!;
const markerPanel = document.querySelector<HTMLElement>('#marker-panel')!;
const sprayPanel = document.querySelector<HTMLElement>('#spray-panel')!;
const toolbar = document.querySelector<HTMLElement>('.toolbar')!;
const toolbarToggle = document.querySelector<HTMLButtonElement>('#toolbar-toggle')!;
const toolSelector = document.querySelector<HTMLElement>('#tool-selector')!;
const colorInput = document.querySelector<HTMLInputElement>('#brush-color')!;
const rotationGroup = document.querySelector<HTMLElement>('#rotation-group')!;
const rotationDial = document.querySelector<HTMLButtonElement>('#rotation-dial')!;
const rotationTip = document.querySelector<HTMLElement>('.rotation-tip-preview')!;
const rotationValue = document.querySelector<HTMLOutputElement>('#rotation-value')!;
const brushCursor = document.querySelector<HTMLElement>('#brush-cursor-preview')!;
const brushCursorTip = document.querySelector<HTMLElement>('.brush-cursor-tip')!;
const backgroundInput = document.querySelector<HTMLInputElement>('#canvas-background')!;
const surfacePicker = document.querySelector<HTMLElement>('#surface-picker')!;
const presetPalette = document.querySelector<HTMLElement>('#preset-palette')!;
const materialPalette = document.querySelector<HTMLElement>('#material-palette')!;
const savedPalette = document.querySelector<HTMLElement>('#saved-palette')!;
const saveColorButton = document.querySelector<HTMLButtonElement>('#save-color-button')!;
const undoButton = document.querySelector<HTMLButtonElement>('#undo-button')!;
const appShell = document.querySelector<HTMLElement>('.app-shell')!;
const topActions = document.querySelector<HTMLElement>('.top-actions')!;
const fullscreenActions = document.querySelector<HTMLElement>('#fullscreen-actions')!;
const modeButton = document.querySelector<HTMLButtonElement>('#canvas-mode-button')!;
const helpButton = document.querySelector<HTMLButtonElement>('#help-button')!;
const helpDialog = document.querySelector<HTMLDialogElement>('#help-dialog')!;
const helpCloseButton = document.querySelector<HTMLButtonElement>('#help-close')!;
const navigatorElement = document.querySelector<HTMLElement>('#navigator')!;
const navigatorMap = document.querySelector<HTMLElement>('#navigator-map')!;
const navigatorCanvas = document.querySelector<HTMLCanvasElement>('#navigator-canvas')!;
const navigatorContext = navigatorCanvas.getContext('2d')!;
const navigatorViewport = document.querySelector<HTMLElement>('#navigator-viewport')!;
const navigatorToggle = document.querySelector<HTMLButtonElement>('#navigator-toggle')!;
const canvasStage = canvas.parentElement!;
const soundToggle = document.querySelector<HTMLButtonElement>('#sound-toggle')!;
const soundPanelToggle = document.querySelector<HTMLButtonElement>('#sound-panel-toggle')!;
const soundVolumeInputs = {
  masterVolume: document.querySelector<HTMLInputElement>('#sound-master-volume')!,
  ambienceVolume: document.querySelector<HTMLInputElement>('#sound-ambience-volume')!,
  effectsVolume: document.querySelector<HTMLInputElement>('#sound-effects-volume')!,
};
const soundPreferenceKey = 'tagbox.audio-settings';
function loadAudioPreferences(): AudioPreferences {
  try {
    const stored = localStorage.getItem(soundPreferenceKey);
    if (stored) {
      const value = JSON.parse(stored) as Partial<AudioPreferences>;
      return {
        enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AUDIO_PREFERENCES.enabled,
        masterVolume: validAudioVolume(value.masterVolume, DEFAULT_AUDIO_PREFERENCES.masterVolume),
        ambienceVolume: validAudioVolume(value.ambienceVolume, DEFAULT_AUDIO_PREFERENCES.ambienceVolume),
        effectsVolume: validAudioVolume(value.effectsVolume, DEFAULT_AUDIO_PREFERENCES.effectsVolume),
      };
    }
  } catch { /* Use defaults when storage is unavailable or invalid. */ }
  return { ...DEFAULT_AUDIO_PREFERENCES };
}
function validAudioVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}
const audio = new AudioManager(loadAudioPreferences());
const canShakeDetector = new CanShakeDetector();
if (window.matchMedia('(pointer: coarse)').matches) {
  for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
    appShell.addEventListener(gesture, (event) => event.preventDefault(), { passive: false });
  }
}
let activeTool: 'marker' | 'spray' = 'marker';
let strokeTool: 'marker' | 'spray' | null = null;
const shapeRotations: Record<'square' | 'chisel' | 'split-chisel', number> = { square: 0, chisel: 140, 'split-chisel': 140 };
let isDrawing = false;
let holdTimer = 0;
let activePointerId: number | null = null;
let activePointerType: string | null = null;
let activePointerPoint: Point | null = null;
let lastCanvasPointer: PointerEvent | null = null;
const touchCandidates = new Map<number, PointerEvent>();
const touchPointerIds = new Set<number>();
const viewportPointers = new Map<number, Point>();
let touchNavigationActive = false;
let pinchStartDistance = 0;
let pinchStartFocal: Point = { x: 0, y: 0 };
let pinchStartZoom = 1;
let pinchStartPan: Point = { x: 0, y: 0 };
let mousePanPointerId: number | null = null;
let spacePanPointerId: number | null = null;
let spacePanHeld = false;
let mousePointerOverCanvas = false;
let mousePanStart: Point = { x: 0, y: 0 };
let mousePanOffset: Point = { x: 0, y: 0 };
let navigatorDragPointerId: number | null = null;
let navigatorDragOffset: Point = { x: 0, y: 0 };
let navigatorRenderFrame = 0;
let activeSurface: CanvasSurface = 'solid';
let solidBackgroundColor = '#000000';
let toolbarWasCollapsedBeforeFullscreen = true;
const gestureMoveThreshold = 8;

function updatePanCursor(): void {
  const isPanActive = mousePanPointerId !== null || spacePanPointerId !== null;
  const canShowPanCursor = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  canvas.style.cursor = canShowPanCursor && isPanActive
    ? 'grabbing'
    : canShowPanCursor && mousePointerOverCanvas && spacePanHeld ? 'grab' : 'crosshair';
}

function resetPanInteraction(): void {
  const capturedPointerIds = new Set([mousePanPointerId, spacePanPointerId].filter((id): id is number => id !== null));
  mousePanPointerId = null;
  spacePanPointerId = null;
  spacePanHeld = false;
  mousePointerOverCanvas = false;
  for (const pointerId of capturedPointerIds) if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  updatePanCursor();
}

function updateBrushCursor(event: PointerEvent): void {
  lastCanvasPointer = event;
  if (event.pointerType === 'touch') { brushCursor.hidden = true; return; }
  const stage = canvasStage;
  const stageRect = stage.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const scale = canvasRect.width / CANVAS_WIDTH;
  const size = (activeTool === 'spray' ? spraySettings.size : settings.size) * scale;
  brushCursor.style.left = `${event.clientX - stageRect.left - stage.clientLeft}px`;
  brushCursor.style.top = `${event.clientY - stageRect.top - stage.clientTop}px`;
  if (activeTool === 'spray') {
    brushCursorTip.dataset.tool = 'spray';
    delete brushCursorTip.dataset.shape;
    brushCursorTip.dataset.nozzle = spraySettings.nozzle;
    brushCursorTip.dataset.material = spraySettings.material;
    brushCursorTip.style.width = `${size}px`;
    brushCursorTip.style.height = `${size * (spraySettings.nozzle === 'calligraphy' ? 0.18 : 1)}px`;
    brushCursorTip.style.transform = `translate(-50%, -50%) rotate(${spraySettings.nozzle === 'calligraphy' ? spraySettings.rotationDegrees : 0}deg)`;
    brushCursorTip.style.background = 'radial-gradient(circle, rgba(220,225,222,.18) 0%, rgba(220,225,222,.08) 48%, rgba(220,225,222,0) 76%)';
    brushCursor.hidden = false;
    return;
  }
  brushCursorTip.dataset.tool = 'marker';
  brushCursorTip.style.background = '';
  const isChisel = settings.shape === 'chisel' || settings.shape === 'split-chisel';
  brushCursorTip.style.width = `${size * (isChisel ? 1.8 : 1)}px`;
  brushCursorTip.style.height = `${size * (isChisel ? (settings.shape === 'split-chisel' ? 0.62 : 0.7) : 1)}px`;
  brushCursorTip.dataset.shape = settings.shape;
  brushCursorTip.dataset.material = settings.material;
  brushCursorTip.style.transform = `translate(-50%, -50%) rotate(${settings.shape === 'round' ? 0 : settings.rotationDegrees}deg)`;
  brushCursor.hidden = false;
}

function setRotation(degrees: number): void {
  settings.rotationDegrees = Math.max(0, Math.min(360, Math.round(degrees)));
  if (settings.shape !== 'round') shapeRotations[settings.shape] = settings.rotationDegrees;
  rotationValue.textContent = `${settings.rotationDegrees}°`;
  rotationDial.setAttribute('aria-valuenow', String(settings.rotationDegrees));
  rotationDial.setAttribute('aria-valuetext', `${settings.rotationDegrees} degrees`);
  rotationTip.style.transform = `translate(-50%, -50%) rotate(${settings.rotationDegrees}deg)`;
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
}

function pointerRotationAngle(event: PointerEvent, dial: HTMLButtonElement): number {
  const rect = dial.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  const aroundDial = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  return ((aroundDial % 360) + 360) % 360;
}

function selectTool(tool: 'marker' | 'spray'): void {
  if (tool === activeTool) return;
  if (isDrawing) finishStroke();
  activeTool = tool;
  canShakeDetector.reset();
  markerPanel.hidden = tool !== 'marker';
  sprayPanel.hidden = tool !== 'spray';
  toolbar.setAttribute('aria-label', tool === 'marker' ? 'Marker settings' : 'Spray Paint settings');
  toolSelector.querySelectorAll<HTMLButtonElement>('.tool-tab').forEach((button) => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateSelection();
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
}

toolSelector.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.tool-tab');
  if (button?.dataset.tool === 'marker' || button?.dataset.tool === 'spray') selectTool(button.dataset.tool);
});

function setSprayRotation(degrees: number): void {
  spraySettings.rotationDegrees = Math.max(0, Math.min(360, Math.round(degrees)));
  sprayRotationValue.textContent = `${spraySettings.rotationDegrees}°`;
  sprayRotationDial.setAttribute('aria-valuenow', String(spraySettings.rotationDegrees));
  sprayRotationDial.setAttribute('aria-valuetext', `${spraySettings.rotationDegrees} degrees`);
  sprayRotationTip.style.transform = `translate(-50%, -50%) rotate(${spraySettings.rotationDegrees}deg)`;
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
}

function bindRotationDial(dial: HTMLButtonElement, getDegrees: () => number, setDegrees: (degrees: number) => void): void {
  let pointerId: number | null = null;
  let previousAngle: number | null = null;

  const setFromPointer = (event: PointerEvent): void => {
    const angle = pointerRotationAngle(event, dial);
    if (previousAngle === null) setDegrees(angle);
    else {
      let delta = angle - previousAngle;
      if (delta > 180) delta -= 360;
      else if (delta < -180) delta += 360;
      setDegrees(getDegrees() + delta);
    }
    previousAngle = angle;
  };

  const stop = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    previousAngle = null;
  };

  const cancel = (): void => {
    const capturedPointerId = pointerId;
    pointerId = null;
    previousAngle = null;
    if (capturedPointerId !== null && dial.hasPointerCapture(capturedPointerId)) dial.releasePointerCapture(capturedPointerId);
  };

  dial.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    previousAngle = null;
    dial.setPointerCapture(event.pointerId);
    setFromPointer(event);
  });
  dial.addEventListener('pointermove', (event) => { if (event.pointerId === pointerId) setFromPointer(event); });
  dial.addEventListener('pointerup', stop);
  dial.addEventListener('pointercancel', stop);
  dial.addEventListener('lostpointercapture', stop);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cancel(); });
  document.addEventListener('fullscreenchange', cancel);
  dial.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setDegrees(getDegrees() + step); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setDegrees(getDegrees() - step); }
    else if (event.key === 'Home') { event.preventDefault(); setDegrees(0); }
    else if (event.key === 'End') { event.preventDefault(); setDegrees(360); }
  });
}

bindRotationDial(rotationDial, () => settings.rotationDegrees, setRotation);
bindRotationDial(sprayRotationDial, () => spraySettings.rotationDegrees, setSprayRotation);

function setToolbarCollapsed(collapsed: boolean): void {
  toolbar.classList.toggle('is-collapsed', collapsed);
  appShell.classList.toggle('toolbar-collapsed', collapsed);
  toolbarToggle.setAttribute('aria-expanded', String(!collapsed));
  toolbarToggle.setAttribute('aria-label', collapsed ? 'Expand settings panel' : 'Collapse settings panel');
  toolbarToggle.title = collapsed ? 'Expand settings panel' : 'Collapse settings panel';
  toolbarToggle.querySelector('.toolbar-toggle-icon')!.textContent = collapsed ? '‹' : '›';
}

function saveAudioPreferences(): void {
  try { localStorage.setItem(soundPreferenceKey, JSON.stringify(audio.getPreferences())); } catch { /* Audio controls remain usable without storage. */ }
}

function syncAudioControls(): void {
  const preferences = audio.getPreferences();
  soundToggle.setAttribute('aria-pressed', String(preferences.enabled));
  soundToggle.setAttribute('aria-label', preferences.enabled ? 'Mute sound' : 'Enable sound');
  soundToggle.title = preferences.enabled ? 'Mute sound' : 'Enable sound';
  soundPanelToggle.setAttribute('aria-pressed', String(preferences.enabled));
  soundPanelToggle.textContent = preferences.enabled ? 'On' : 'Off';
  for (const [kind, input] of Object.entries(soundVolumeInputs) as Array<[keyof typeof soundVolumeInputs, HTMLInputElement]>) {
    const percent = Math.round(preferences[kind] * 100);
    input.value = String(percent);
    document.querySelector<HTMLOutputElement>(`#sound-${kind.replace('Volume', '').toLowerCase()}-value`)!.textContent = `${percent}%`;
  }
}

function setSoundEnabled(enabled: boolean): void {
  audio.setEnabled(enabled);
  syncAudioControls();
  saveAudioPreferences();
}

syncAudioControls();
soundToggle.addEventListener('click', () => setSoundEnabled(!audio.getPreferences().enabled));
soundPanelToggle.addEventListener('click', () => setSoundEnabled(!audio.getPreferences().enabled));
for (const [kind, input] of Object.entries(soundVolumeInputs) as Array<[keyof typeof soundVolumeInputs, HTMLInputElement]>) {
  input.addEventListener('input', () => {
    audio.setVolume(kind, Number(input.value) / 100);
    syncAudioControls();
    saveAudioPreferences();
  });
}

function updateNavigatorSize(): void {
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const maxWidth = mobile ? 150 : 220;
  const maxHeight = mobile ? 110 : 150;
  const aspect = CANVAS_WIDTH / CANVAS_HEIGHT;
  const width = Math.min(maxWidth, maxHeight * aspect);
  const height = width / aspect;
  navigatorCanvas.width = Math.max(1, Math.round(width));
  navigatorCanvas.height = Math.max(1, Math.round(height));
  navigatorCanvas.style.width = `${width}px`;
  navigatorCanvas.style.height = `${height}px`;
  navigatorMap.style.width = `${width}px`;
  navigatorMap.style.height = `${height}px`;
}

function updateNavigatorViewport(): void {
  const rect = navigation.visibleLogicalRect();
  navigatorViewport.style.left = `${rect.x / CANVAS_WIDTH * 100}%`;
  navigatorViewport.style.top = `${rect.y / CANVAS_HEIGHT * 100}%`;
  navigatorViewport.style.width = `${rect.width / CANVAS_WIDTH * 100}%`;
  navigatorViewport.style.height = `${rect.height / CANVAS_HEIGHT * 100}%`;
}

function drawNavigator(): void {
  navigatorRenderFrame = 0;
  const width = navigatorCanvas.width;
  const height = navigatorCanvas.height;
  navigatorContext.clearRect(0, 0, width, height);
  navigatorContext.fillStyle = '#17191a';
  navigatorContext.fillRect(0, 0, width, height);
  const layers = activeSurface === 'norrtag' || activeSurface === 'citypark'
    ? [backgroundCanvas, foregroundCanvas, canvas, runoffCanvas]
    : [backgroundCanvas, canvas, runoffCanvas, foregroundCanvas];
  for (const layer of layers) {
    navigatorContext.drawImage(layer, 0, 0, width, height);
  }
}

function requestNavigatorRender(): void {
  if (!navigatorRenderFrame) navigatorRenderFrame = requestAnimationFrame(drawNavigator);
}

function applyNavigation(): void {
  const width = CANVAS_WIDTH * navigation.scale;
  const height = CANVAS_HEIGHT * navigation.scale;
  renderer.setDisplaySize(width, height);
  for (const layer of [backgroundCanvas, foregroundCanvas]) {
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
  }
  const stage = canvasStage;
  stage.style.setProperty('--canvas-pan-x', `${navigation.pan.x}px`);
  stage.style.setProperty('--canvas-pan-y', `${navigation.pan.y}px`);
  const environmentPanFactor = getSurfaceEnvironmentParallax(activeSurface);
  stage.style.setProperty('--background-pan-x', `${navigation.pan.x * environmentPanFactor}px`);
  stage.style.setProperty('--background-pan-y', `${navigation.pan.y * environmentPanFactor}px`);
  updateNavigatorViewport();
  requestNavigatorRender();
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
}

function resizeCanvas(): void {
  const stage = canvasStage;
  const widthScale = stage.clientWidth / CANVAS_WIDTH;
  const heightScale = stage.clientHeight / CANVAS_HEIGHT;
  const baseScale = appShell.classList.contains('canvas-only')
    ? Math.max(widthScale, heightScale)
    : Math.min(widthScale, heightScale);
  navigation.resize(stage.clientWidth, stage.clientHeight, baseScale);
  const displayWidth = CANVAS_WIDTH * navigation.scale;
  const displayHeight = CANVAS_HEIGHT * navigation.scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT, dpr, displayWidth, displayHeight);
  for (const layer of [backgroundCanvas, foregroundCanvas]) {
    layer.width = Math.max(1, Math.round(CANVAS_WIDTH * dpr));
    layer.height = Math.max(1, Math.round(CANVAS_HEIGHT * dpr));
    layer.style.width = `${displayWidth}px`; layer.style.height = `${displayHeight}px`;
  }
  const bg = backgroundCanvas.getContext('2d')!;
  bg.setTransform(backgroundCanvas.width / CANVAS_WIDTH, 0, 0, backgroundCanvas.height / CANVAS_HEIGHT, 0, 0);
  drawSurface(bg, activeSurface, solidBackgroundColor);
  const fg = foregroundCanvas.getContext('2d')!;
  fg.setTransform(foregroundCanvas.width / CANVAS_WIDTH, 0, 0, foregroundCanvas.height / CANVAS_HEIGHT, 0, 0);
  drawForeground(fg, activeSurface);
  updateNavigatorSize();
  applyNavigation();
}
new ResizeObserver(resizeCanvas).observe(canvas.parentElement!);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
window.visualViewport?.addEventListener('resize', resizeCanvas);
resizeCanvas();

function startStroke(event: PointerEvent, initialEvent = event): void {
  if (isDrawing) return;
  isDrawing = true;
  strokeTool = activeTool;
  activePointerId = event.pointerId;
  activePointerType = event.pointerType;
  activePointerPoint = { x: initialEvent.clientX, y: initialEvent.clientY };
  const point = pointerPosition(initialEvent, canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
  if (strokeTool === 'marker') brush.begin(point, initialEvent.timeStamp, settings.size, settings.color, settings.smoothing, settings.wetness, settings.shape, settings.material, settings.rotationDegrees, settings.splatterEnabled);
  else {
    spraySettings.size = clampSpraySize(spraySettings.size);
    spray.begin(point, initialEvent.timeStamp, spraySettings.size, settings.color, spraySettings.smoothing, spraySettings.pressure, spraySettings.material, spraySettings.nozzle, spraySettings.rotationDegrees);
    audio.startSpray();
  }
  holdTimer = window.setInterval(() => { if (isDrawing && strokeTool === 'marker') brush.hold(); }, 60);
}
function cancelStroke(): void {
  if (!isDrawing) return;
  isDrawing = false;
  activePointerId = null;
  activePointerType = null;
  activePointerPoint = null;
  window.clearInterval(holdTimer);
  if (strokeTool === 'marker') brush.end();
  else if (strokeTool === 'spray') { spray.end(); audio.endSpray(); }
  strokeTool = null;
  renderer.setOperations(operations);
  requestNavigatorRender();
}
function clearCanvas(): void {
  if (isDrawing) finishStroke();
  operations.length = 0; renderer.clear(); undoButton.disabled = true; requestNavigatorRender();
}
canvas.addEventListener('pointerdown', (event) => {
  canShakeDetector.reset();
  if (event.pointerType === 'touch') {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    touchPointerIds.add(event.pointerId);
    if (touchPointerIds.size <= 2) viewportPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointerIds.size >= 2) {
      touchNavigationActive = true;
      touchCandidates.clear();
      cancelStroke();
      const points = [...viewportPointers.values()];
      pinchStartDistance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      pinchStartZoom = navigation.zoom;
      pinchStartPan = { ...navigation.pan };
      const stageRect = canvas.parentElement!.getBoundingClientRect();
      pinchStartFocal = { x: (points[0].x + points[1].x) / 2 - stageRect.left, y: (points[0].y + points[1].y) / 2 - stageRect.top };
      return;
    }
    touchCandidates.set(event.pointerId, event);
    return;
  }
  if (spacePanHeld && event.pointerType === 'mouse' && event.button === 0) {
    event.preventDefault();
    cancelStroke();
    spacePanPointerId = event.pointerId;
    updatePanCursor();
    mousePanStart = { x: event.clientX, y: event.clientY };
    mousePanOffset = { ...navigation.pan };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  if (touchNavigationActive) return;
  if (event.button === 1 || (event.pointerType === 'mouse' && event.button === 2)) {
    event.preventDefault();
    cancelStroke();
    mousePanPointerId = event.pointerId;
    mousePanStart = { x: event.clientX, y: event.clientY };
    mousePanOffset = { ...navigation.pan };
    canvas.setPointerCapture(event.pointerId);
    updatePanCursor();
    return;
  }
  if (event.button !== 0) return;
  if (isDrawing) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  touchCandidates.clear();
  startStroke(event);
});
canvas.addEventListener('pointerenter', (event) => {
  if (event.pointerType === 'mouse') { mousePointerOverCanvas = true; updatePanCursor(); }
  updateBrushCursor(event);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse') { mousePointerOverCanvas = true; updatePanCursor(); }
  updateBrushCursor(event);
  if (isDrawing && event.pointerId === activePointerId) activePointerPoint = { x: event.clientX, y: event.clientY };
  const canShakeEligible = event.pointerType === 'mouse' && event.buttons === 0 && activeTool === 'spray' && !isDrawing && !spacePanHeld && spacePanPointerId === null && mousePanPointerId === null && navigatorDragPointerId === null && !touchNavigationActive;
  if (canShakeEligible) {
    if (canShakeDetector.move(event.clientX, event.clientY, event.timeStamp)) audio.playCanShake();
  } else canShakeDetector.reset();
  if (mousePanPointerId === event.pointerId || spacePanPointerId === event.pointerId) {
    navigation.setPan(mousePanOffset.x + event.clientX - mousePanStart.x, mousePanOffset.y + event.clientY - mousePanStart.y);
    applyNavigation();
    return;
  }
  if (viewportPointers.has(event.pointerId) && touchNavigationActive) {
    viewportPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...viewportPointers.values()];
    if (points.length >= 2) {
      const stageRect = canvas.parentElement!.getBoundingClientRect();
      const stage = canvas.parentElement!;
      const midpoint = { x: (points[0].x + points[1].x) / 2 - stageRect.left, y: (points[0].y + points[1].y) / 2 - stageRect.top };
      const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      const zoom = Math.max(navigation.minZoom, Math.min(navigation.maxZoom, pinchStartZoom * distance / pinchStartDistance));
      const ratio = zoom / pinchStartZoom;
      navigation.setTransform(zoom, {
        x: midpoint.x - stage.clientWidth / 2 - (pinchStartFocal.x - stage.clientWidth / 2 - pinchStartPan.x) * ratio,
        y: midpoint.y - stage.clientHeight / 2 - (pinchStartFocal.y - stage.clientHeight / 2 - pinchStartPan.y) * ratio,
      });
      applyNavigation();
      return;
    }
  }
  if (touchNavigationActive) return;
  const candidate = touchCandidates.get(event.pointerId);
  if (candidate && Math.hypot(event.clientX - candidate.clientX, event.clientY - candidate.clientY) > gestureMoveThreshold) {
    if (touchCandidates.size === 1) {
      touchCandidates.clear();
      startStroke(event, candidate);
      requestNavigatorRender();
    }
  }
  if (!isDrawing || event.pointerId !== activePointerId) return;
  const coalesced = [...(event.getCoalescedEvents?.() ?? [event])].sort((a, b) => a.timeStamp - b.timeStamp);
  for (const sample of coalesced) {
    const point = pointerPosition(sample, canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (strokeTool === 'marker') brush.move(point, sample.timeStamp);
    else if (strokeTool === 'spray') spray.move(point, sample.timeStamp);
  }
  requestNavigatorRender();
});
canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'mouse') { mousePointerOverCanvas = false; updatePanCursor(); }
  if (!isDrawing) brushCursor.hidden = true;
  if (spacePanPointerId === event.pointerId && !canvas.hasPointerCapture(event.pointerId)) { spacePanPointerId = null; updatePanCursor(); }
});
function finishStroke(event?: PointerEvent): void {
  if (!isDrawing) return;
  if (event && event.pointerId !== activePointerId) return;
  if (event?.type === 'pointerup') {
    const point = pointerPosition(event, canvas, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (strokeTool === 'marker') brush.move(point, event.timeStamp);
    else if (strokeTool === 'spray') spray.move(point, event.timeStamp);
  }
  isDrawing = false;
  activePointerId = null;
  activePointerType = null;
  activePointerPoint = null;
  window.clearInterval(holdTimer);
  if (strokeTool === 'marker') {
    const stroke = brush.end();
    if (stroke) { const operation: PaintOperation = { kind: 'marker', stroke }; operations.push(operation); renderer.commitOperation(operation); undoButton.disabled = false; }
  } else if (strokeTool === 'spray') {
    const stroke = spray.end();
    audio.endSpray();
    if (stroke) { const operation: PaintOperation = { kind: 'spray', stroke }; operations.push(operation); renderer.commitOperation(operation); undoButton.disabled = false; }
  }
  strokeTool = null;
  requestNavigatorRender();
}
canvas.addEventListener('pointerup', (event) => {
  if (mousePanPointerId === event.pointerId) { mousePanPointerId = null; updatePanCursor(); return; }
  if (spacePanPointerId === event.pointerId) { spacePanPointerId = null; updatePanCursor(); return; }
  const wasTouch = touchPointerIds.has(event.pointerId);
  if (wasTouch) touchPointerIds.delete(event.pointerId);
  if (viewportPointers.has(event.pointerId)) {
    viewportPointers.delete(event.pointerId);
    if (touchNavigationActive) {
      if (touchPointerIds.size === 0) touchNavigationActive = false;
      return;
    }
  }
  if (wasTouch && touchNavigationActive) return;
  if (touchCandidates.has(event.pointerId)) {
    if (touchCandidates.size === 1) {
      const initial = touchCandidates.get(event.pointerId)!;
      startStroke(event, initial);
      finishStroke(event);
    }
    touchCandidates.delete(event.pointerId);
    return;
  }
  finishStroke(event);
  if (wasTouch && touchPointerIds.size === 0) requestNavigatorRender();
});
canvas.addEventListener('pointercancel', (event) => {
  if (mousePanPointerId === event.pointerId) { mousePanPointerId = null; updatePanCursor(); return; }
  if (spacePanPointerId === event.pointerId) { spacePanPointerId = null; updatePanCursor(); return; }
  const wasTouch = touchPointerIds.delete(event.pointerId);
  viewportPointers.delete(event.pointerId);
  if (touchPointerIds.size === 0) touchNavigationActive = false;
  if (wasTouch && touchNavigationActive) return;
  if (touchCandidates.has(event.pointerId)) {
    touchCandidates.delete(event.pointerId);
    return;
  }
  if (isDrawing && event.pointerId === activePointerId) cancelStroke();
});
canvas.addEventListener('lostpointercapture', (event) => {
  if (mousePanPointerId === event.pointerId) { mousePanPointerId = null; updatePanCursor(); }
  if (spacePanPointerId === event.pointerId) { spacePanPointerId = null; updatePanCursor(); }
  touchPointerIds.delete(event.pointerId);
  touchCandidates.delete(event.pointerId);
  viewportPointers.delete(event.pointerId);
  if (!touchPointerIds.size) touchNavigationActive = false;
  if (isDrawing && event.pointerId === activePointerId) cancelStroke();
});
canvas.addEventListener('wheel', (event) => {
  canShakeDetector.reset();
  if (event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const stageRect = canvas.parentElement!.getBoundingClientRect();
  navigation.setZoomAt(navigation.zoom * Math.exp(-event.deltaY * 0.0015), { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top });
  applyNavigation();
}, { passive: false });

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !['range', 'checkbox', 'color', 'button', 'submit', 'reset', 'radio', 'file'].includes(target.type);
  return target.closest('textarea, [role="textbox"], [role="searchbox"], [contenteditable]:not([contenteditable="false"])') !== null;
}

document.addEventListener('keydown', (event) => {
  const isTyping = isTextEntryTarget(event.target);
  if (event.code === 'Space' && !helpDialog.open && !isTyping) {
    event.preventDefault();
    if (!spacePanHeld) {
      spacePanHeld = true;
      updatePanCursor();
      canShakeDetector.reset();
      if (isDrawing && activePointerId !== null && activePointerType === 'mouse') {
        spacePanPointerId = activePointerId;
        updatePanCursor();
        const point = activePointerPoint ?? { x: 0, y: 0 };
        mousePanStart = { ...point };
        mousePanOffset = { ...navigation.pan };
        cancelStroke();
      }
    }
    return;
  }
  if (helpDialog.open || isTyping) return;
  if (event.key === 'Escape' && appShell.classList.contains('canvas-only')) { void exitCanvasOnly(); return; }
  if (event.key === 'Delete' && !event.repeat && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    event.preventDefault();
    clearCanvas();
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (!event.repeat) undo();
}, true);
document.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  const wasSpacePanHeld = spacePanHeld;
  spacePanHeld = false;
  spacePanPointerId = null;
  updatePanCursor();
  if (wasSpacePanHeld) event.preventDefault();
}, true);
window.addEventListener('blur', () => {
  resetPanInteraction();
  canShakeDetector.reset();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    resetPanInteraction();
    canShakeDetector.reset();
  }
});

navigatorToggle.addEventListener('click', () => {
  const hidden = navigatorElement.classList.toggle('is-hidden');
  navigatorToggle.setAttribute('aria-expanded', String(!hidden));
  navigatorToggle.setAttribute('aria-label', hidden ? 'Show navigator' : 'Hide navigator');
  navigatorToggle.title = hidden ? 'Show navigator' : 'Hide navigator';
  navigatorToggle.textContent = hidden ? '⌕' : '−';
});
navigatorMap.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  navigatorMap.setPointerCapture(event.pointerId);
  navigatorDragPointerId = event.pointerId;
  const mapRect = navigatorMap.getBoundingClientRect();
  const point = { x: (event.clientX - mapRect.left) / mapRect.width * CANVAS_WIDTH, y: (event.clientY - mapRect.top) / mapRect.height * CANVAS_HEIGHT };
  const viewportRect = navigatorViewport.getBoundingClientRect();
  const withinViewport = event.clientX >= viewportRect.left && event.clientX <= viewportRect.right && event.clientY >= viewportRect.top && event.clientY <= viewportRect.bottom;
  const center = navigation.logicalCenter();
  navigatorDragOffset = withinViewport ? { x: point.x - center.x, y: point.y - center.y } : { x: 0, y: 0 };
  navigation.setLogicalCenter({ x: point.x - navigatorDragOffset.x, y: point.y - navigatorDragOffset.y });
  applyNavigation();
});
navigatorMap.addEventListener('pointermove', (event) => {
  if (navigatorDragPointerId !== event.pointerId) return;
  const mapRect = navigatorMap.getBoundingClientRect();
  const point = { x: (event.clientX - mapRect.left) / mapRect.width * CANVAS_WIDTH, y: (event.clientY - mapRect.top) / mapRect.height * CANVAS_HEIGHT };
  navigation.setLogicalCenter({ x: point.x - navigatorDragOffset.x, y: point.y - navigatorDragOffset.y });
  applyNavigation();
});
const endNavigatorDrag = (event: PointerEvent): void => { if (navigatorDragPointerId === event.pointerId) navigatorDragPointerId = null; };
navigatorMap.addEventListener('pointerup', endNavigatorDrag);
navigatorMap.addEventListener('pointercancel', endNavigatorDrag);
navigatorMap.addEventListener('lostpointercapture', endNavigatorDrag);

async function enterCanvasOnly(): Promise<void> {
  toolbarWasCollapsedBeforeFullscreen = toolbar.classList.contains('is-collapsed');
  appShell.classList.add('canvas-only');
  canvasStage.append(soundToggle);
  setToolbarCollapsed(true);
  for (const control of [document.querySelector('#export-button')!, undoButton, document.querySelector('#clear-button')!, helpButton, modeButton]) fullscreenActions.append(control);
  modeButton.textContent = 'Exit fullscreen';
  try { if (!document.fullscreenElement && appShell.requestFullscreen) await appShell.requestFullscreen(); } catch { /* CSS canvas-only mode remains available when fullscreen is denied. */ }
  resizeCanvas();
}
async function exitCanvasOnly(): Promise<void> {
  appShell.classList.remove('canvas-only');
  topActions.append(soundToggle);
  setToolbarCollapsed(toolbarWasCollapsedBeforeFullscreen);
  modeButton.textContent = 'Fullscreen';
  for (const control of [document.querySelector('#export-button')!, undoButton, document.querySelector('#clear-button')!, helpButton, modeButton]) topActions.append(control);
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch { /* Keep the fullscreen controls available. */ }
  }
  resizeCanvas();
}
modeButton.addEventListener('click', () => appShell.classList.contains('canvas-only') ? void exitCanvasOnly() : void enterCanvasOnly());
helpButton.addEventListener('click', () => {
  helpDialog.showModal();
  helpCloseButton.focus();
});
helpCloseButton.addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (event) => {
  if (event.target !== helpDialog) return;
  const rect = helpDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) helpDialog.close();
});
helpDialog.addEventListener('close', () => helpButton.focus());
document.addEventListener('fullscreenchange', () => {
  resetPanInteraction();
  resizeCanvas();
  if (!document.fullscreenElement && appShell.classList.contains('canvas-only')) {
    appShell.classList.remove('canvas-only'); modeButton.textContent = 'Fullscreen';
    topActions.append(soundToggle);
    setToolbarCollapsed(toolbarWasCollapsedBeforeFullscreen);
    for (const control of [document.querySelector('#export-button')!, undoButton, document.querySelector('#clear-button')!, helpButton, modeButton]) topActions.append(control);
    resizeCanvas();
  }
});

sizeInput.addEventListener('input', () => {
  settings.size = clampBrushSize(Number(sizeInput.value));
  sizeInput.value = String(settings.size);
  document.querySelector('#size-value')!.textContent = `${settings.size} px`;
});
smoothingInput.addEventListener('input', () => {
  settings.smoothing = Number(smoothingInput.value) / 100;
  document.querySelector('#smoothing-value')!.textContent = `${smoothingInput.value}%`;
});
wetnessInput.addEventListener('input', () => {
  settings.wetness = Number(wetnessInput.value) / 100;
  document.querySelector('#wetness-value')!.textContent = `${wetnessInput.value}%`;
});
spraySizeInput.addEventListener('input', () => {
  spraySettings.size = clampSpraySize(Number(spraySizeInput.value));
  spraySizeInput.value = String(spraySettings.size);
  document.querySelector('#spray-size-value')!.textContent = `${spraySettings.size} px`;
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
});
sprayPressureInput.addEventListener('input', () => {
  spraySettings.pressure = Number(sprayPressureInput.value) / 100;
  document.querySelector('#spray-pressure-value')!.textContent = `${sprayPressureInput.value}%`;
});
spraySmoothingInput.addEventListener('input', () => {
  spraySettings.smoothing = Number(spraySmoothingInput.value) / 100;
  document.querySelector('#spray-smoothing-value')!.textContent = `${spraySmoothingInput.value}%`;
});
document.querySelectorAll<HTMLButtonElement>('.spray-nozzle-option').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.nozzle !== 'standard' && button.dataset.nozzle !== 'calligraphy') return;
  const changed = spraySettings.nozzle !== button.dataset.nozzle;
  spraySettings.nozzle = button.dataset.nozzle;
  if (changed) audio.playCapChange();
  sprayRotationGroup.hidden = spraySettings.nozzle !== 'calligraphy';
  document.querySelectorAll<HTMLButtonElement>('.spray-nozzle-option').forEach((option) => {
    const selected = option.dataset.nozzle === spraySettings.nozzle;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
}));
intensityInput.addEventListener('input', () => {
  settings.intensity = Number(intensityInput.value) / 100;
  renderer.setRunIntensity(settings.intensity);
  document.querySelector('#run-intensity-value')!.textContent = `${intensityInput.value}%`;
});
const splatterEnabledKey = 'tagbox.paint-splatter';
try { settings.splatterEnabled = localStorage.getItem(splatterEnabledKey) !== 'false'; } catch { /* Keep splatter enabled when storage is unavailable. */ }
splatterInput.checked = settings.splatterEnabled;
splatterInput.addEventListener('change', () => {
  settings.splatterEnabled = splatterInput.checked;
  try { localStorage.setItem(splatterEnabledKey, String(settings.splatterEnabled)); } catch { /* New strokes still honor the in-memory setting. */ }
});
const presetColors = [
  '#ffffff', '#d9ff00', '#ff4d29', '#a77bff', '#32d6c3', '#111111', '#72777b', '#c7c9c5',
  '#ff6b6b', '#ff9f1c', '#ffd166', '#06d6a0', '#118ab2', '#4361ee', '#f72585', '#8d5a3b',
];
const brushColorKey = 'tagbox.brush-color';
const brushMaterialKey = 'tagbox.brush-material';
const sprayMaterialKey = 'tagbox.spray-material';
const savedColorsKey = 'tagbox.saved-colors';
const backgroundColorKey = 'tagbox.canvas-background';
const surfaceKey = 'tagbox.canvas-surface';
const validColor = (color: string): boolean => /^#[0-9a-f]{6}$/i.test(color);
function readSavedColors(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedColorsKey) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((color): color is string => typeof color === 'string' && validColor(color)).map((color) => color.toLowerCase()))] : [];
  } catch { return []; }
}
let savedColors = readSavedColors();
function setColor(color: string, selectPaint = true, playSound = false): void {
  if (!validColor(color)) return;
  color = color.toLowerCase();
  const changed = settings.color !== color;
  settings.color = color;
  if (playSound && changed) audio.playCanColor();
  if (selectPaint) {
    if (activeTool === 'marker') {
      settings.material = 'paint';
      try { localStorage.setItem(brushMaterialKey, 'paint'); } catch { /* Drawing remains available when storage is disabled. */ }
    } else {
      spraySettings.material = 'paint';
      try { localStorage.setItem(sprayMaterialKey, 'paint'); } catch { /* Drawing remains available when storage is disabled. */ }
    }
  }
  colorInput.value = color;
  document.querySelector('#color-value')!.textContent = color.toUpperCase();
  document.querySelector<HTMLElement>('#color-swatch')!.style.backgroundColor = color;
  try { localStorage.setItem(brushColorKey, color); } catch { /* Drawing remains available when storage is disabled. */ }
  updateSelection();
}
function updateSelection(): void {
  const selectedMaterial = activeTool === 'spray' ? spraySettings.material : settings.material;
  const selectingColor = selectedMaterial === 'paint';
  presetPalette.querySelectorAll<HTMLButtonElement>('.swatch').forEach((swatch) => swatch.classList.toggle('active', selectingColor && swatch.dataset.color === settings.color));
  savedPalette.querySelectorAll<HTMLButtonElement>('.swatch').forEach((swatch) => swatch.classList.toggle('active', selectingColor && swatch.dataset.color === settings.color));
  materialPalette.querySelectorAll<HTMLButtonElement>('.material-swatch').forEach((button) => button.classList.toggle('active', !selectingColor && button.dataset.material === selectedMaterial));
}
function setMaterial(material: Material): void {
  if (activeTool === 'spray') {
    const changed = spraySettings.material !== material;
    spraySettings.material = material;
    if (changed && material !== 'paint') audio.playCanColor();
    try { localStorage.setItem(sprayMaterialKey, material); } catch { /* Drawing remains available when storage is disabled. */ }
  } else {
    const changed = settings.material !== material;
    settings.material = material;
    if (changed && material !== 'paint') audio.playCanColor();
    try { localStorage.setItem(brushMaterialKey, material); } catch { /* Drawing remains available when storage is disabled. */ }
  }
  updateSelection();
}
function addSwatch(container: HTMLElement, color: string, removable = false): void {
  const wrapper = document.createElement('span');
  wrapper.className = 'palette-item';
  const swatch = document.createElement('button');
  swatch.type = 'button'; swatch.className = 'swatch'; swatch.dataset.color = color;
  swatch.style.setProperty('--swatch', color); swatch.setAttribute('aria-label', `Select ${color}`); swatch.title = color;
  swatch.addEventListener('click', () => setColor(color, true, true));
  wrapper.append(swatch);
  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'remove-swatch'; remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${color} from saved colors`);
    remove.addEventListener('click', () => {
      savedColors = savedColors.filter((saved) => saved !== color);
      try { localStorage.setItem(savedColorsKey, JSON.stringify(savedColors)); } catch { /* Keep the in-memory palette usable. */ }
      renderPalettes();
    });
    wrapper.append(remove);
  }
  container.append(wrapper);
}
function renderPalettes(): void {
  presetPalette.replaceChildren(); savedPalette.replaceChildren();
  presetColors.forEach((color) => addSwatch(presetPalette, color));
  savedColors.forEach((color) => addSwatch(savedPalette, color, true));
  materialPalette.replaceChildren();
  for (const [material, label, style] of [['silver-chrome', 'Silver Chrome', 'silver'], ['copper-chrome', 'Copper Chrome', 'copper'], ['gold-chrome', 'Gold Chrome', 'gold']] as const) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `material-swatch ${style}`; button.dataset.material = material; button.textContent = label;
    button.setAttribute('aria-label', `Select ${label}`); button.addEventListener('click', () => setMaterial(material));
    materialPalette.append(button);
  }
  setColor(settings.color, false);
}
try {
  const storedColor = localStorage.getItem(brushColorKey);
  if (storedColor && validColor(storedColor)) settings.color = storedColor.toLowerCase();
} catch { /* Use the default brush color when storage is unavailable. */ }
try {
  const storedMaterial = localStorage.getItem(brushMaterialKey);
  if (storedMaterial === 'silver-chrome' || storedMaterial === 'copper-chrome' || storedMaterial === 'gold-chrome') settings.material = storedMaterial;
} catch { /* Use ordinary paint when storage is unavailable. */ }
try {
  const storedMaterial = localStorage.getItem(sprayMaterialKey);
  if (storedMaterial === 'silver-chrome' || storedMaterial === 'copper-chrome' || storedMaterial === 'gold-chrome') spraySettings.material = storedMaterial;
} catch { /* Use ordinary spray when storage is unavailable. */ }
renderPalettes();
colorInput.addEventListener('input', () => setColor(colorInput.value, true, true));
saveColorButton.addEventListener('click', () => {
  const color = settings.color.toLowerCase();
  if (savedColors.includes(color) || presetColors.includes(color)) return;
  savedColors.push(color);
  try { localStorage.setItem(savedColorsKey, JSON.stringify(savedColors)); } catch { /* Keep the in-memory palette usable. */ }
  renderPalettes();
});
function setBackgroundColor(color: string): void {
  if (!validColor(color)) return;
  color = color.toLowerCase();
  backgroundInput.value = color;
  document.querySelector<HTMLElement>('.background-color-swatch')!.style.backgroundColor = backgroundInput.value;
  solidBackgroundColor = color;
  const ctx = backgroundCanvas.getContext('2d');
  if (ctx) { ctx.setTransform(backgroundCanvas.width / CANVAS_WIDTH, 0, 0, backgroundCanvas.height / CANVAS_HEIGHT, 0, 0); drawSurface(ctx, activeSurface, solidBackgroundColor); }
  requestNavigatorRender();
  try { localStorage.setItem(backgroundColorKey, color); } catch { /* Keep background changes usable when storage is disabled. */ }
}
try {
  const storedBackground = localStorage.getItem(backgroundColorKey);
  solidBackgroundColor = storedBackground && validColor(storedBackground) ? storedBackground : '#000000';
  setBackgroundColor(solidBackgroundColor);
  const storedSurface = localStorage.getItem(surfaceKey);
  if (storedSurface) activeSurface = storedSurface;
} catch { /* Use the default solid surface when storage is unavailable. */ }
function renderSurfaceOptions(): void {
  surfacePicker.replaceChildren();
  const options: Array<{ id: string; name: string; thumb: string }> = [
    { id: 'solid', name: 'Solid', thumb: 'surface-thumb-solid' },
    { id: 'steel-gate', name: 'Steel Gate', thumb: 'surface-thumb-steel' },
    ...getCustomSurfaces().map(({ id, name }) => ({ id, name, thumb: id === 'norrtag' ? 'surface-thumb-norrtag' : id === 'citypark' ? 'surface-thumb-citypark' : 'surface-thumb-custom' })),
  ];
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'surface-option'; button.dataset.surface = option.id;
    const thumb = option.id === 'norrtag' || option.id === 'citypark' ? document.createElement('img') : document.createElement('span');
    thumb.className = `surface-thumb ${option.thumb}`;
    thumb.setAttribute('aria-hidden', 'true');
    if (thumb instanceof HTMLImageElement) { thumb.src = '/surfaces/norrtag/norrtag_v3.png'; thumb.alt = ''; thumb.draggable = false; }
    if (thumb instanceof HTMLImageElement && option.id === 'citypark') thumb.src = '/surfaces/citypark-thumbnail.png';
    const label = document.createElement('span'); label.textContent = option.name;
    button.append(thumb, label);
    surfacePicker.append(button);
  }
  updateSurface();
}
function updateSurface(): void {
  const dimensions = getSurfaceDimensions(activeSurface);
  if (dimensions.width !== CANVAS_WIDTH || dimensions.height !== CANVAS_HEIGHT) {
    CANVAS_WIDTH = dimensions.width;
    CANVAS_HEIGHT = dimensions.height;
    navigation.setLogicalSize(CANVAS_WIDTH, CANVAS_HEIGHT);
    navigation.setBounds(getSurfaceNavigationBounds(activeSurface));
    resizeCanvas();
  }
  canvas.parentElement!.classList.toggle('surface-norrtag', activeSurface === 'norrtag');
  canvas.parentElement!.classList.toggle('surface-citypark', activeSurface === 'citypark');
  navigation.setBounds(getSurfaceNavigationBounds(activeSurface));
  audio.setSurfaceAmbience(getSurfaceAmbience(activeSurface));
  surfacePicker.querySelectorAll<HTMLButtonElement>('.surface-option').forEach((button) => {
    const selected = button.dataset.surface === activeSurface;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
  });
  const bg = backgroundCanvas.getContext('2d')!;
  bg.setTransform(backgroundCanvas.width / CANVAS_WIDTH, 0, 0, backgroundCanvas.height / CANVAS_HEIGHT, 0, 0);
  drawSurface(bg, activeSurface, solidBackgroundColor);
  const fg = foregroundCanvas.getContext('2d')!;
  fg.setTransform(foregroundCanvas.width / CANVAS_WIDTH, 0, 0, foregroundCanvas.height / CANVAS_HEIGHT, 0, 0);
  drawForeground(fg, activeSurface);
  renderer.setRunoffObstacles(getSurfaceObstacles(activeSurface));
  renderer.setPaintMask(getSurfacePaintMask(activeSurface));
  applyNavigation();
  try { localStorage.setItem(surfaceKey, activeSurface); } catch { /* Keep surface changes usable when storage is unavailable. */ }
}
surfacePicker.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.surface-option');
  if (!button?.dataset.surface) return;
  if (button.dataset.surface === activeSurface) return;
  clearCanvas();
  activeSurface = button.dataset.surface;
  updateSurface();
});
window.addEventListener('tagbox-surface-assets-ready', updateSurface);
window.addEventListener('tagbox-custom-surfaces-ready', () => {
  if (activeSurface !== 'solid' && activeSurface !== 'steel-gate' && !getCustomSurfaces().some(({ id }) => id === activeSurface)) activeSurface = 'solid';
  renderSurfaceOptions();
});
renderSurfaceOptions();
backgroundInput.addEventListener('input', () => setBackgroundColor(backgroundInput.value));

document.querySelector<HTMLButtonElement>('#export-button')!.addEventListener('click', () => {
  const output = document.createElement('canvas'); output.width = CANVAS_WIDTH; output.height = CANVAS_HEIGHT;
  const ctx = output.getContext('2d')!;
  ctx.drawImage(backgroundCanvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  if (activeSurface === 'norrtag' || activeSurface === 'citypark') {
    ctx.drawImage(foregroundCanvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.drawImage(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else {
    ctx.drawImage(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.drawImage(foregroundCanvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
  output.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = timestampedExportFilename(); link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
document.querySelectorAll<HTMLButtonElement>('.brush-shape-option').forEach((button) => button.addEventListener('click', () => {
  const shape = button.dataset.shape as typeof settings.shape;
  const changed = settings.shape !== shape;
  settings.shape = shape;
  if (changed) audio.playCapChange();
  rotationGroup.hidden = settings.shape === 'round';
  if (settings.shape !== 'round') {
    rotationTip.dataset.shape = settings.shape;
    setRotation(shapeRotations[settings.shape]);
  }
  if (lastCanvasPointer) updateBrushCursor(lastCanvasPointer);
  document.querySelectorAll<HTMLButtonElement>('.brush-shape-option').forEach((option) => {
    const selected = option === button;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
}));
function undo(): void {
  if (!operations.length) return;
  operations.pop(); renderer.setOperations(operations); undoButton.disabled = operations.length === 0;
  requestNavigatorRender();
}
undoButton.addEventListener('click', undo);
const clearButton = document.querySelector<HTMLButtonElement>('#clear-button')!;
clearButton.addEventListener('click', clearCanvas);
toolbarToggle.addEventListener('click', () => {
  setToolbarCollapsed(!toolbar.classList.contains('is-collapsed'));
});
