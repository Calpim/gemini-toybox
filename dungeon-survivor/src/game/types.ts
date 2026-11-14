import type { DungeonMap } from '../core/dungeon';

export type GameStatus = 'playing' | 'gameover';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  x: number;
  y: number;
  radius: number;
  speed: number;
  hp: number;
  maxHp: number;
  /** Natural HP regeneration rate; explicitly 0 per APP-MAP-03 */
  autoRegenPerSec: number;
  level: number;
  exp: number;
  expToNext: number;
  skillPoints: number;
  invulnTimer: number;
  facingAngle: number;
  blasterCooldown: number;
  blasterRange: number;
  blasterDamage: number;
  orbitAngle: number;
  orbitRadius: number;
  orbitCount: number;
  orbitDamage: number;
}

export interface EnemyState {
  id: number;
  x: number;
  y: number;
  radius: number;
  speed: number;
  hp: number;
  maxHp: number;
  damage: number;
  aggroRange: number;
  awake: boolean;
  hitFlash: number;
  bitHitCooldown: number;
}

export interface ProjectileState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
}

export type PickupKind = 'exp' | 'heal';

export interface PickupState {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  value: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface GameStats {
  kills: number;
  floorsCleared: number;
  totalExp: number;
}

export interface GameState {
  seed: number;
  floor: number;
  status: GameStatus;
  map: DungeonMap;
  explored: Uint8Array;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
  floatingTexts: FloatingText[];
  nextEntityId: number;
  floorBannerTimer: number;
  stats: GameStats;
}
