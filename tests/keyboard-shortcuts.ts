export {};

const result = document.querySelector<HTMLElement>('#result')!;
const frame = document.querySelector<HTMLIFrameElement>('#app')!;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const rateStorageKey = 'tagbox.spider-weave-speed';
const previousRate = localStorage.getItem(rateStorageKey);
localStorage.removeItem(rateStorageKey);

function wait(milliseconds = 30): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait();
  }
  throw new Error(message);
}

function pressed(doc: Document, tool: string): boolean {
  return doc.querySelector<HTMLButtonElement>(`.tool-tab[data-tool="${tool}"]`)?.getAttribute('aria-pressed') === 'true';
}

function press(doc: Document, key: string, target: EventTarget = doc, options: KeyboardEventInit = {}): KeyboardEvent {
  const view = doc.defaultView!;
  const event = new view.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

function setInput(doc: Document, id: string, value: string): void {
  const input = doc.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));
}

try {
  await new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.addEventListener('error', () => reject(new Error('Tagbox test frame failed to load.')), { once: true });
    frame.src = '/';
  });
  const win = frame.contentWindow! as Window & typeof globalThis;
  const doc = frame.contentDocument!;
  await waitFor(() => Boolean(doc.querySelector('#tool-selector')) && doc.querySelector<HTMLElement>('#loading-indicator')?.hidden === true, 'Tagbox did not finish initializing.');
  const shell = doc.querySelector<HTMLElement>('.app-shell')!;
  const modeButton = doc.querySelector<HTMLButtonElement>('#canvas-mode-button')!;
  const modeLabel = (): string | null => modeButton.textContent;

  assert(pressed(doc, 'marker'), 'Marker should be the initial tool.');
  assert(doc.querySelector<HTMLInputElement>('#spray-size')!.value === '96', 'Unused Spray should keep its default size.');
  assert(doc.querySelector<HTMLInputElement>('#spray-pressure')!.value === '55', 'Unused Spray should keep its default pressure.');
  assert(doc.querySelector<HTMLInputElement>('#spray-smoothing')!.value === '45', 'Unused Spray should keep its default smoothing.');
  assert(doc.querySelector<HTMLInputElement>('#spider-weave-rate')!.value === '50', 'Unused Spider should keep the default 50× rate.');
  assert(doc.querySelector<HTMLButtonElement>('.spray-nozzle-option[data-nozzle="standard"]')!.getAttribute('aria-pressed') === 'true', 'Unused Spray should keep the default nozzle.');
  press(doc, 'b');
  assert(pressed(doc, 'spray'), 'B should select Spray.');
  assert(doc.querySelector<HTMLInputElement>('#spray-size')!.value === '96', 'B should expose Spray defaults without modifying them.');

  setInput(doc, 'spray-size', '145');
  setInput(doc, 'spray-pressure', '42');
  setInput(doc, 'spray-smoothing', '27');
  doc.querySelector<HTMLButtonElement>('.spray-nozzle-option[data-nozzle="spider"]')!.click();
  setInput(doc, 'spider-weave-rate', '73');
  setInput(doc, 'brush-size', '23');
  doc.querySelector<HTMLButtonElement>('.brush-shape-option[data-shape="square"]')!.click();
  setInput(doc, 'eraser-size', '41');

  press(doc, 'm');
  assert(pressed(doc, 'marker'), 'M should select Marker.');
  assert(doc.querySelector<HTMLInputElement>('#brush-size')!.value === '23', 'Marker settings should survive tool switching.');
  press(doc, 'e');
  assert(pressed(doc, 'erase'), 'E should select Eraser.');
  assert(doc.querySelector<HTMLInputElement>('#eraser-size')!.value === '41', 'Eraser settings should survive tool switching.');
  press(doc, 'b');
  assert(pressed(doc, 'spray'), 'B should select Spray again.');
  assert(doc.querySelector<HTMLInputElement>('#spray-size')!.value === '145', 'Spray size should survive tool switching.');
  assert(doc.querySelector<HTMLInputElement>('#spray-pressure')!.value === '42', 'Spray pressure should survive tool switching.');
  assert(doc.querySelector<HTMLInputElement>('#spray-smoothing')!.value === '27', 'Spray smoothing should survive tool switching.');
  assert(doc.querySelector<HTMLButtonElement>('.spray-nozzle-option[data-nozzle="spider"]')!.getAttribute('aria-pressed') === 'true', 'Selected Spray nozzle should survive tool switching.');
  assert(doc.querySelector<HTMLInputElement>('#spider-weave-rate')!.value === '73', 'Spider rate should survive tool switching.');
  press(doc, 'm');
  assert(doc.querySelector<HTMLButtonElement>('.brush-shape-option[data-shape="square"]')!.classList.contains('active'), 'Marker tip selection should survive tool switching.');

  const edit = doc.createElement('input'); edit.type = 'text'; doc.body.append(edit);
  const textarea = doc.createElement('textarea'); doc.body.append(textarea);
  const editable = doc.createElement('div'); editable.contentEditable = 'true'; doc.body.append(editable);
  const modeBeforeTyping = shell.classList.contains('canvas-only');
  press(doc, 'e', edit);
  assert(pressed(doc, 'marker'), 'Tool shortcuts should be ignored in text inputs.');
  press(doc, 'e', textarea);
  assert(pressed(doc, 'marker'), 'Tool shortcuts should be ignored in textareas.');
  press(doc, 'e', editable);
  assert(pressed(doc, 'marker'), 'Tool shortcuts should be ignored in contenteditable elements.');
  press(doc, 'b', doc.querySelector<HTMLInputElement>('#brush-size')!);
  assert(pressed(doc, 'marker'), 'Tool shortcuts should be ignored on interactive controls.');
  press(doc, 'f', modeButton);
  assert(shell.classList.contains('canvas-only') === modeBeforeTyping, 'Fullscreen shortcut should be ignored on buttons.');
  press(doc, 'b', doc, { repeat: true });
  assert(pressed(doc, 'marker'), 'Repeated shortcut keydown events should not change tools.');
  press(doc, 'b', doc, { ctrlKey: true });
  assert(pressed(doc, 'marker'), 'Modified letters should remain available to browser and application commands.');

  const fullscreenCalls = { request: 0, exit: 0 };
  const requestCount = (): number => fullscreenCalls.request;
  const exitCount = (): number => fullscreenCalls.exit;
  let simulatedFullscreenElement: Element | null = null;
  Object.defineProperty(doc, 'fullscreenElement', { configurable: true, get: () => simulatedFullscreenElement });
  Object.defineProperty(shell, 'requestFullscreen', { configurable: true, value: async () => {
    fullscreenCalls.request++;
    simulatedFullscreenElement = shell;
    doc.dispatchEvent(new win.Event('fullscreenchange'));
  } });
  Object.defineProperty(doc, 'exitFullscreen', { configurable: true, value: async () => {
    fullscreenCalls.exit++;
    simulatedFullscreenElement = null;
    doc.dispatchEvent(new win.Event('fullscreenchange'));
  } });

  press(doc, 'f', doc, { repeat: true });
  assert(requestCount() === 0, 'Repeated F keydown events should not toggle fullscreen.');
  press(doc, 'f');
  await wait();
  assert(requestCount() === 1 && shell.classList.contains('canvas-only'), 'F should enter through the Fullscreen API and synchronize the app layout.');
  assert(modeLabel() === 'Exit fullscreen', 'Fullscreen entry should update its control label.');
  press(doc, 'f');
  await wait();
  assert(exitCount() === 1 && !shell.classList.contains('canvas-only'), 'F should exit through the Fullscreen API and restore the app layout.');

  simulatedFullscreenElement = doc.querySelector('#paint-canvas');
  doc.dispatchEvent(new win.Event('fullscreenchange'));
  assert(shell.classList.contains('canvas-only') && modeLabel() === 'Exit fullscreen', 'Externally initiated fullscreen entry should synchronize the app layout.');
  simulatedFullscreenElement = null;
  doc.dispatchEvent(new win.Event('fullscreenchange'));
  assert(!shell.classList.contains('canvas-only') && modeLabel() === 'Fullscreen', 'Browser or Escape fullscreen exit should restore the app layout.');
  simulatedFullscreenElement = shell;
  doc.dispatchEvent(new win.Event('fullscreenchange'));
  press(doc, 'Escape');
  await wait();
  assert(exitCount() === 2 && !shell.classList.contains('canvas-only'), 'Escape should exit fullscreen and synchronize the app layout.');

  const externalElement = doc.createElement('div');
  doc.body.append(externalElement);
  simulatedFullscreenElement = externalElement;
  doc.dispatchEvent(new win.Event('fullscreenchange'));
  press(doc, 'f');
  await wait();
  assert(requestCount() === 2 && simulatedFullscreenElement === shell, 'F should request fullscreen for Tagbox when another page element is fullscreen.');
  press(doc, 'f');
  await wait();
  assert(exitCount() === 3 && !shell.classList.contains('canvas-only'), 'F should exit fullscreen after transitioning from another page element.');

  const undoEvent = press(doc, 'z', doc, { ctrlKey: true });
  assert(undoEvent.defaultPrevented, 'Ctrl+Z should remain handled by the existing undo shortcut.');
  const spaceEvent = press(doc, ' ', doc, { code: 'Space' });
  assert(spaceEvent.defaultPrevented, 'Space should remain handled by the existing pan shortcut.');
  doc.dispatchEvent(new win.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
  Object.defineProperty(win, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: query === '(hover: hover) and (pointer: fine)' }) });
  const deleteEvent = press(doc, 'Delete');
  assert(deleteEvent.defaultPrevented, 'Delete should remain handled by the existing clear shortcut.');

  result.dataset.state = 'passed';
  result.textContent = 'PASS\nB/M/E/F, tool setting preservation, editable-control guards, key repeat/modifiers, Fullscreen API synchronization, and existing keyboard shortcuts.';
} catch (error) {
  result.dataset.state = 'failed';
  result.textContent = `FAIL\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  throw error;
} finally {
  if (previousRate === null) localStorage.removeItem(rateStorageKey);
  else localStorage.setItem(rateStorageKey, previousRate);
}
