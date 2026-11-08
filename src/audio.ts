export type AudioCategory = 'ambience' | 'effects';

export interface AudioPreferences {
  enabled: boolean;
  masterVolume: number;
  ambienceVolume: number;
  effectsVolume: number;
}

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  enabled: true,
  masterVolume: 0.65,
  ambienceVolume: 0.22,
  effectsVolume: 0.7,
};

/** Stable ambience identifiers mapped to their original on-disk asset paths. */
export const AMBIENCE_ASSETS: Readonly<Record<string, string>> = {
  urban: '/audio/ambience/jadeallencook-night-city-side-street-with-passing-cars-and-distant-urban-ambience-339223.mp3',
};

export const SHAKE_DETECTION = {
  minimumSegmentDistance: 24,
  minimumVelocity: 600,
  maximumVerticalRatio: 0.55,
  minimumDirectionChanges: 3,
  windowMs: 1100,
  cooldownMs: 1200,
} as const;

interface CachedAudio {
  element: HTMLAudioElement;
  category: AudioCategory;
  gain: number;
  failed?: boolean;
  fade?: { from: number; to: number; started: number; duration: number; pauseWhenDone: boolean };
}

/** Owns every audio element and playback lifecycle; it has no canvas/rendering dependencies. */
export class AudioManager {
  private readonly cache = new Map<string, CachedAudio>();
  private readonly sprayStart = '/audio/spray/spray-start.mp3';
  private readonly sprayLoop = '/audio/spray/spray-loop.mp3';
  private readonly sprayEnd = '/audio/spray/spray-end.mp3';
  private readonly canShake = '/audio/spray/can-shake.mp3';
  private readonly capChange = '/audio/spray/cap-change.mp3';
  private readonly canColor = '/audio/spray/can-color.mp3';
  private preferences: AudioPreferences;
  private ambienceAsset: string | null = null;
  private sprayToken = 0;
  private sprayActive = false;
  private pendingStartToken: number | null = null;
  private pendingReleaseToken: number | null = null;
  private fadeFrame = 0;
  private shakeElement: CachedAudio | null = null;

  constructor(preferences: AudioPreferences) {
    this.preferences = { ...preferences };
    document.addEventListener('pointerdown', () => this.resumeAmbient(), true);
    document.addEventListener('keydown', () => this.resumeAmbient(), true);
  }

  getPreferences(): AudioPreferences { return { ...this.preferences }; }

  setEnabled(enabled: boolean): void {
    if (this.preferences.enabled === enabled) return;
    this.preferences.enabled = enabled;
    if (!enabled) {
      this.pendingStartToken = null;
      this.pendingReleaseToken = null;
      for (const entry of this.cache.values()) {
        entry.element.volume = 0;
        entry.element.pause();
      }
      return;
    }
    this.resumeAmbient();
    if (this.sprayActive) this.playLoop();
  }

  setVolume(kind: 'masterVolume' | 'ambienceVolume' | 'effectsVolume', value: number): void {
    this.preferences[kind] = clamp(value);
    for (const entry of this.cache.values()) this.applyVolume(entry);
  }

  setSurfaceAmbience(asset: string | null): void {
    const source = asset ? (AMBIENCE_ASSETS[asset] ?? asset) : null;
    if (this.ambienceAsset === source) return;
    this.ambienceAsset = source;
    if (!asset) {
      for (const entry of this.cache.values()) if (entry.category === 'ambience') this.fade(entry, 0, 260, true);
      return;
    }
    const next = this.getAudio(source!, 'ambience');
    for (const [src, entry] of this.cache) {
      if (entry.category === 'ambience' && src !== source && !entry.element.paused) this.fade(entry, 0, 260, true);
    }
    next.element.loop = true;
    if (!this.preferences.enabled) {
      next.gain = 1;
      next.element.volume = 0;
      return;
    }
    const wasPaused = next.element.paused;
    if (wasPaused) next.gain = 0;
    this.fade(next, 1, 260, false);
    if (wasPaused) void this.play(next).catch(() => undefined);
  }

  startSpray(): void {
    this.sprayActive = true;
    const token = ++this.sprayToken;
    this.pendingReleaseToken = null;
    this.stop(this.getAudio(this.sprayLoop, 'effects'));
    this.stop(this.getAudio(this.sprayEnd, 'effects'));
    const start = this.getAudio(this.sprayStart, 'effects');
    this.stop(start);
    if (!this.preferences.enabled) return;
    this.pendingStartToken = token;
    start.element.loop = false;
    start.element.onended = () => this.finishSprayStart(token);
    start.element.onerror = () => this.finishSprayStart(token);
    void this.play(start).catch(() => this.finishSprayStart(token));
  }

  endSpray(): void {
    if (!this.sprayActive) return;
    this.sprayActive = false;
    const token = this.sprayToken;
    const loop = this.cache.get(this.sprayLoop);
    if (loop && !loop.element.paused) this.fade(loop, 0, 65, true);
    if (!this.preferences.enabled) {
      this.pendingStartToken = null;
      this.pendingReleaseToken = null;
      return;
    }
    const start = this.cache.get(this.sprayStart);
    if (this.pendingStartToken === token && start) {
      this.pendingReleaseToken = token;
    } else {
      this.pendingStartToken = null;
      this.playSprayEnd();
    }
  }

  playCanShake(): void {
    if (!this.preferences.enabled) return;
    const entry = this.shakeElement ??= this.getAudio(this.canShake, 'effects');
    this.restart(entry);
  }

  playCapChange(): void { this.playEffect(this.capChange); }

  playCanColor(): void { this.playEffect(this.canColor); }

  /** Release audio on user interaction after an autoplay policy rejection. */
  resumeAmbient(): void {
    if (!this.preferences.enabled || !this.ambienceAsset) return;
    const entry = this.cache.get(this.ambienceAsset) ?? this.getAudio(this.ambienceAsset, 'ambience');
    if (!entry.element.paused || entry.failed) return;
    entry.element.loop = true;
    void this.play(entry).catch(() => undefined);
  }

  private finishSprayStart(token: number): void {
    if (this.pendingStartToken !== token) return;
    this.pendingStartToken = null;
    if (!this.preferences.enabled || token !== this.sprayToken) return;
    if (this.sprayActive) this.playLoop();
    else if (this.pendingReleaseToken === token) {
      this.pendingReleaseToken = null;
      this.playSprayEnd();
    }
  }

  private playLoop(): void {
    if (!this.preferences.enabled || !this.sprayActive) return;
    const loop = this.getAudio(this.sprayLoop, 'effects');
    loop.element.loop = true;
    loop.gain = 1;
    this.applyVolume(loop);
    if (loop.element.paused) void this.play(loop).catch(() => undefined);
  }

  private playSprayEnd(): void {
    if (!this.preferences.enabled) return;
    const end = this.getAudio(this.sprayEnd, 'effects');
    end.element.loop = false;
    this.restart(end);
  }

  private playEffect(src: string): void {
    if (!this.preferences.enabled) return;
    this.restart(this.getAudio(src, 'effects'));
  }

  private getAudio(src: string, category: AudioCategory): CachedAudio {
    let entry = this.cache.get(src);
    if (!entry) {
      const element = new Audio(src);
      element.preload = 'auto';
      entry = { element, category, gain: 1 };
      this.cache.set(src, entry);
    }
    return entry;
  }

  private async play(entry: CachedAudio): Promise<void> {
    if (entry.failed) throw new Error('Audio asset is unavailable.');
    entry.element.preload = 'auto';
    this.applyVolume(entry);
    try { await entry.element.play(); }
    catch (error) {
      if (entry.element.error) entry.failed = true;
      throw error;
    }
  }

  private restart(entry: CachedAudio): void {
    this.stop(entry);
    if (this.preferences.enabled) void this.play(entry).catch(() => undefined);
  }

  private stop(entry: CachedAudio): void {
    entry.fade = undefined;
    entry.element.pause();
    try { entry.element.currentTime = 0; } catch { /* Metadata may not have loaded yet. */ }
  }

  private fade(entry: CachedAudio, target: number, duration: number, pauseWhenDone: boolean): void {
    if (entry.fade) {
      const current = entry.fade;
      const progress = Math.min(1, (performance.now() - current.started) / current.duration);
      entry.gain = current.from + (current.to - current.from) * progress;
    }
    entry.fade = { from: entry.gain, to: target, started: performance.now(), duration, pauseWhenDone };
    this.scheduleFadeFrame();
  }

  private scheduleFadeFrame(): void {
    if (this.fadeFrame) return;
    this.fadeFrame = requestAnimationFrame((time) => {
      this.fadeFrame = 0;
      let active = false;
      for (const entry of this.cache.values()) {
        const fade = entry.fade;
        if (!fade) continue;
        const progress = Math.min(1, (time - fade.started) / fade.duration);
        entry.gain = fade.from + (fade.to - fade.from) * progress;
        this.applyVolume(entry);
        if (progress >= 1) {
          entry.fade = undefined;
          if (fade.pauseWhenDone && entry.gain <= 0.001) this.stop(entry);
        } else active = true;
      }
      if (active) this.scheduleFadeFrame();
    });
  }

  private applyVolume(entry: CachedAudio): void {
    const categoryVolume = entry.category === 'ambience' ? this.preferences.ambienceVolume : this.preferences.effectsVolume;
    entry.element.volume = this.preferences.enabled ? clamp(this.preferences.masterVolume * categoryVolume * entry.gain) : 0;
  }
}

interface ShakePoint { x: number; y: number; time: number }

/** Distance/velocity based reversal detector; it never captures or suppresses pointer events. */
export class CanShakeDetector {
  private previous: ShakePoint | null = null;
  private runStart: ShakePoint | null = null;
  private lastDirection = 0;
  private reversalTimes: number[] = [];
  private cooldownUntil = 0;

  reset(): void {
    this.previous = null;
    this.runStart = null;
    this.lastDirection = 0;
    this.reversalTimes = [];
  }

  move(x: number, y: number, time: number): boolean {
    const point = { x, y, time };
    if (!this.previous) {
      this.previous = this.runStart = point;
      return false;
    }
    const previous = this.previous;
    this.previous = point;
    const run = this.runStart ?? previous;
    const dx = x - run.x;
    const dy = y - run.y;
    const elapsed = Math.max(1, time - run.time);
    const distance = Math.abs(dx);
    if (elapsed > SHAKE_DETECTION.windowMs) {
      this.runStart = point;
      this.lastDirection = 0;
      this.reversalTimes = [];
      return false;
    }
    if (Math.abs(dy) > Math.max(16, distance * SHAKE_DETECTION.maximumVerticalRatio)) {
      this.runStart = point;
      return false;
    }
    if (distance < SHAKE_DETECTION.minimumSegmentDistance || distance / (elapsed / 1000) < SHAKE_DETECTION.minimumVelocity) return false;
    const direction = Math.sign(dx);
    this.runStart = point;
    if (this.lastDirection && direction !== this.lastDirection) {
      this.reversalTimes.push(time);
      this.reversalTimes = this.reversalTimes.filter((stamp) => time - stamp <= SHAKE_DETECTION.windowMs);
      if (time >= this.cooldownUntil && this.reversalTimes.length >= SHAKE_DETECTION.minimumDirectionChanges) {
        this.cooldownUntil = time + SHAKE_DETECTION.cooldownMs;
        this.reversalTimes = [];
        this.lastDirection = 0;
        return true;
      }
    }
    this.lastDirection = direction;
    return false;
  }
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
