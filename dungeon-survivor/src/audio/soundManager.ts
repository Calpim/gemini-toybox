import type { SoundEventKind } from '../game/types';

const STORAGE_MUTED_KEY = 'dungeon_survivor_muted';

const MIN_INTERVAL_MS: Partial<Record<SoundEventKind, number>> = {
  shot: 75,
  blade: 90,
  coil: 100,
  hit: 55,
  kill: 45,
  pickup_exp: 45,
  pickup_heal: 80,
  pickup_equip: 120,
  alert: 300,
  boss_dash: 180,
};

export class SoundManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastPlayedAt = new Map<SoundEventKind, number>();

  constructor() {
    try {
      if (typeof localStorage !== 'undefined') {
        this.muted = localStorage.getItem(STORAGE_MUTED_KEY) === '1';
      }
    } catch {
      this.muted = false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_MUTED_KEY, muted ? '1' : '0');
      }
    } catch {
      // ignore storage errors
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    if (!this.muted) {
      this.unlock();
    }
    return this.muted;
  }

  unlock(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  playBatch(events: SoundEventKind[] | undefined): void {
    if (!events || events.length === 0) return;
    if (this.muted) {
      events.length = 0;
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      events.length = 0;
      return;
    }

    const nowMs = performance.now();
    // Cap per-frame synthesis to avoid audio glitches during huge AoE hits
    let playedCount = 0;
    for (let i = 0; i < events.length; i++) {
      const kind = events[i];
      if (!kind) continue;
      const minGap = MIN_INTERVAL_MS[kind] ?? 30;
      const prev = this.lastPlayedAt.get(kind) ?? 0;
      if (nowMs - prev < minGap) continue;
      if (playedCount >= 6) break;
      this.lastPlayedAt.set(kind, nowMs);
      this.playSingle(ctx, kind);
      playedCount++;
    }
    events.length = 0;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private playTone(
    ctx: AudioContext,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    duration: number,
    gainPeak: number,
    delay = 0,
  ): void {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), t0);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + Math.min(0.01, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  private playNoise(
    ctx: AudioContext,
    filterFreq: number,
    duration: number,
    gainPeak: number,
    filterType: BiquadFilterType = 'bandpass',
    delay = 0,
  ): void {
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, t0);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.01);
  }

  private playSingle(ctx: AudioContext, kind: SoundEventKind): void {
    switch (kind) {
      case 'shot':
        this.playTone(ctx, 'triangle', 680, 260, 0.075, 0.065);
        break;
      case 'blade':
        this.playNoise(ctx, 2200, 0.09, 0.09, 'highpass');
        this.playTone(ctx, 'sawtooth', 520, 210, 0.08, 0.05);
        break;
      case 'coil':
        this.playTone(ctx, 'square', 960, 420, 0.06, 0.045);
        this.playTone(ctx, 'sawtooth', 1240, 620, 0.05, 0.035, 0.025);
        break;
      case 'hit':
        this.playTone(ctx, 'triangle', 220, 95, 0.055, 0.085);
        break;
      case 'kill':
        this.playTone(ctx, 'square', 240, 75, 0.11, 0.07);
        this.playNoise(ctx, 900, 0.1, 0.075, 'lowpass');
        break;
      case 'boss_kill':
        this.playTone(ctx, 'sawtooth', 180, 45, 0.34, 0.12);
        this.playNoise(ctx, 700, 0.28, 0.14, 'lowpass');
        this.playTone(ctx, 'triangle', 523.25, 523.25, 0.14, 0.09, 0.14);
        this.playTone(ctx, 'triangle', 659.25, 659.25, 0.16, 0.09, 0.23);
        this.playTone(ctx, 'triangle', 783.99, 783.99, 0.25, 0.1, 0.32);
        break;
      case 'player_hit':
        this.playTone(ctx, 'sawtooth', 160, 58, 0.16, 0.13);
        this.playNoise(ctx, 500, 0.12, 0.1, 'lowpass');
        break;
      case 'parry':
        this.playTone(ctx, 'sine', 880, 1480, 0.11, 0.09);
        this.playTone(ctx, 'triangle', 1320, 1760, 0.1, 0.06, 0.03);
        break;
      case 'pickup_exp':
        this.playTone(ctx, 'sine', 740, 980, 0.055, 0.055);
        break;
      case 'pickup_heal':
        this.playTone(ctx, 'sine', 523.25, 659.25, 0.09, 0.08);
        this.playTone(ctx, 'sine', 783.99, 1046.5, 0.12, 0.08, 0.06);
        break;
      case 'pickup_equip':
        this.playTone(ctx, 'triangle', 587.33, 587.33, 0.08, 0.09);
        this.playTone(ctx, 'triangle', 880, 880, 0.15, 0.1, 0.075);
        break;
      case 'level_up':
        this.playTone(ctx, 'triangle', 523.25, 523.25, 0.09, 0.1, 0);
        this.playTone(ctx, 'triangle', 659.25, 659.25, 0.09, 0.1, 0.07);
        this.playTone(ctx, 'triangle', 783.99, 783.99, 0.09, 0.1, 0.14);
        this.playTone(ctx, 'triangle', 1046.5, 1046.5, 0.22, 0.11, 0.21);
        break;
      case 'alert':
        this.playTone(ctx, 'square', 840, 840, 0.07, 0.07, 0);
        this.playTone(ctx, 'square', 1120, 1120, 0.1, 0.075, 0.09);
        break;
      case 'stairs_unlock':
        this.playTone(ctx, 'triangle', 440, 440, 0.12, 0.09, 0);
        this.playTone(ctx, 'triangle', 554.37, 554.37, 0.12, 0.09, 0.08);
        this.playTone(ctx, 'triangle', 659.25, 659.25, 0.2, 0.1, 0.16);
        break;
      case 'boss_dash':
        this.playTone(ctx, 'sawtooth', 260, 90, 0.18, 0.09);
        this.playNoise(ctx, 1200, 0.15, 0.08, 'bandpass');
        break;
      case 'floor_clear':
        this.playTone(ctx, 'sine', 440, 880, 0.18, 0.09);
        this.playTone(ctx, 'sine', 660, 1320, 0.22, 0.08, 0.08);
        break;
    }
  }
}
