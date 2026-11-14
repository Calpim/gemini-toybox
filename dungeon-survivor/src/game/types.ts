import type { DungeonMap } from '../core/dungeon';
import type { EquippedItem } from './equipment';
import type { SkillNodeId } from './skillTree';

export type GameStatus = 'playing' | 'skill_tree' | 'equip_choice' | 'gameover';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  x: number;
  y: number;
  radius: number;
  baseSpeed: number;
  hp: number;
  maxHp: number;
  /** Natural HP regeneration rate; explicitly 0 per APP-MAP-03 */
  autoRegenPerSec: number;
  level: number;
  exp: number;
  expToNext: number;
  skillPoints: number;
  unlockedSkills: SkillNodeId[];
  equipment: EquippedItem[];
  invulnTimer: number;
  facingAngle: number;
  orbitAngle: number;
  orbitRadius: number;
  repulsorCooldown: number;
  aegisCooldown: number;
  tacticalStepCooldown: number;
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
  pierce: boolean;
  hitEnemyIds: number[];
  color: string;
}

export interface EnemyProjectileState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
}

export interface ChestState {
  id: number;
  x: number;
  y: number;
  opened: boolean;
}

export interface PendingEquipDrop {
  item: EquippedItem;
}

export interface VisualFx {
  kind: 'slash' | 'lightning' | 'pulse';
  x: number;
  y: number;
  radius?: number;
  angle?: number;
  points?: Vec2[];
  color: string;
  life: number;
  maxLife: number;
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
  chestsOpened: number;
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
  enemyProjectiles: EnemyProjectileState[];
  chests: ChestState[];
  pendingEquipDrop: PendingEquipDrop | null;
  pickups: PickupState[];
  floatingTexts: FloatingText[];
  visualFx: VisualFx[];
  nextEntityId: number;
  floorBannerTimer: number;
  stats: GameStats;
}
