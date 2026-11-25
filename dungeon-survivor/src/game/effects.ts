import type { GameNotification, GameState, SoundEventKind } from './types';

const MAX_PARTICLES = 140;

export function emitSound(state: GameState, kind: SoundEventKind): void {
  if (!state.soundEvents) state.soundEvents = [];
  if (state.soundEvents.length < 32) {
    state.soundEvents.push(kind);
  }
}

export function triggerShake(state: GameState, intensity: number, duration: number): void {
  state.shakeIntensity = Math.max(state.shakeIntensity ?? 0, intensity);
  state.shakeTimer = Math.max(state.shakeTimer ?? 0, duration);
}

export function spawnParticles(
  state: GameState,
  x: number,
  y: number,
  color: string,
  count: number,
  speedMin: number,
  speedMax: number,
  radius: number,
  life: number,
): void {
  if (!state.particles) state.particles = [];
  const available = MAX_PARTICLES - state.particles.length;
  const n = Math.min(count, available);
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / Math.max(1, n) + ((state.nextEntityId + i * 7) % 10) * 0.09;
    const spd = speedMin + ((i * 37 + state.nextEntityId * 13) % 100) * 0.01 * (speedMax - speedMin);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      radius,
      color,
      life,
      maxLife: life,
    });
  }
}

export function pushNotification(
  state: GameState,
  kind: GameNotification['kind'],
  text: string,
  color: string,
  life = 2.0,
): void {
  if (kind === 'alert') {
    const existingAlert = state.notifications.find((n) => n.kind === 'alert' && n.life > 1.2);
    if (existingAlert) {
      existingAlert.life = life;
      existingAlert.maxLife = life;
      existingAlert.text = text;
      return;
    }
  }
  state.notifications.push({
    id: state.nextEntityId++,
    kind,
    text,
    color,
    life,
    maxLife: life,
  });
  if (state.notifications.length > 3) {
    state.notifications.shift();
  }
}
