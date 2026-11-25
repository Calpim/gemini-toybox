import type { DungeonMap } from '../core/dungeon';
import type { EquipmentId, EquippedItem } from './equipment';
import type { SkillNodeId } from './skillTree';

export type GameStatus = 'title' | 'playing' | 'skill_tree' | 'equip_choice' | 'gameover';

export interface Vec2 {
  x: number;
  y: number;
}

export type MainWeaponId = 'core_shot';

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
  spentSkillPoints: number;
  skillLevels: Partial<Record<SkillNodeId, number>>;
  mainWeaponId?: MainWeaponId;
  equipment: EquippedItem[];
  maxEquipSlots: number;
  scrapExpandProgress: number;
  invulnTimer: number;
  facingAngle: number;
  orbitAngle: number;
  orbitRadius: number;
  baseAttackCooldown: number;
  repulsorCooldown: number;
  aegisCooldown: number;
  tacticalStepCooldown: number;
  tacticalStepCharges?: number;
  tacticalSpeedTimer?: number;
  tacticalSpeedBonus?: number;
  velX?: number;
  velY?: number;
}

export type EnemyKind = 'normal' | 'tank' | 'runner' | 'shooter' | 'scout';

export interface EnemyState {
  id: number;
  kind?: EnemyKind;
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
  attackCooldown?: number;
  alertCooldown?: number;
  spawnDelay?: number;
  wanderTarget?: Vec2 | null;
  wanderTimer?: number;
  wanderDir?: Vec2 | null;
  isAmbush?: boolean;
  isPackFollower?: boolean;
  summonerId?: number;
  isStairsGuard?: boolean;
  isRoomBoss?: boolean;
  isGrandBoss?: boolean;
  bossPatternIndex?: number;
  dashState?: 'none' | 'windup' | 'dashing' | 'recovering';
  dashTimer?: number;
  dashDir?: Vec2;
  dashSpeed?: number;
  dashBouncesLeft?: number;
  mortarCooldown?: number;
}

export interface ProjectileState {
  id: number;
  kind?: 'base' | 'base_homing' | 'drone' | 'disc' | 'reflected';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  pierce: boolean;
  bouncesLeft?: number;
  wallBouncesLeft?: number;
  speed?: number;
  spinAngle?: number;
  homingTurnRate?: number;
  homingRange?: number;
  homingDashSpeed?: number;
  trail?: Vec2[];
  baseLevel?: number;
  overclockLevel?: number;
  isCenterCharge?: boolean;
  visualTier?: number;
  orbitAngle?: number;
  orbitTimer?: number;
  orbitRadius?: number;
  orbitAngularSpeed?: number;
  loopCenterX?: number | undefined;
  loopCenterY?: number | undefined;
  loopRadius?: number | undefined;
  loopAngle?: number | undefined;
  loopProgress?: number | undefined;
  loopDir?: 1 | -1 | undefined;
  loopTargetEnemyId?: number | undefined;
  loopExitAngle?: number | undefined;
  expandTimer?: number;
  expandDuration?: number;
  expandTargetRadius?: number;
  traveledDist?: number;
  maxDistance?: number;
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
  bouncesLeft?: number;
  homingRate?: number;
  pierceDefense?: boolean;
  color?: string;
}

export interface MortarZoneState {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  radius: number;
  damage: number;
  elapsed: number;
  duration: number;
}

export interface BossLaserState {
  id: number;
  points: Vec2[];
  width: number;
  damage: number;
  elapsed: number;
  windup: number;
  duration: number;
  hitPlayer: boolean;
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
  halfArcRad?: number;
  fullCircle?: boolean;
  thickness?: number;
  points?: Vec2[];
  color: string;
  life: number;
  maxLife: number;
}

export type PickupKind = 'exp' | 'heal' | 'equip';

export interface PickupState {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  value: number;
  equipmentId?: EquipmentId;
  itemLevel?: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface GameNotification {
  id: number;
  kind: 'levelup' | 'alert' | 'info';
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
  elapsedPlayTime: number;
  clearTime10F?: number;
}

export type SoundEventKind =
  | 'shot'
  | 'blade'
  | 'coil'
  | 'hit'
  | 'kill'
  | 'boss_kill'
  | 'player_hit'
  | 'parry'
  | 'pickup_exp'
  | 'pickup_heal'
  | 'pickup_equip'
  | 'level_up'
  | 'alert'
  | 'stairs_unlock'
  | 'boss_dash'
  | 'floor_clear';

export interface ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
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
  mortarZones: MortarZoneState[];
  bossLasers?: BossLaserState[];
  chests: ChestState[];
  pendingEquipDrop: PendingEquipDrop | null;
  pickups: PickupState[];
  floatingTexts: FloatingText[];
  visualFx: VisualFx[];
  particles?: ParticleState[];
  soundEvents?: SoundEventKind[];
  shakeTimer?: number;
  shakeIntensity?: number;
  notifications: GameNotification[];
  elapsedFloorTime: number;
  respawnTimer: number;
  stairsNoticeCooldown?: number;
  fountainUsed?: boolean;
  nextEntityId: number;
  floorBannerTimer: number;
  stats: GameStats;
}
