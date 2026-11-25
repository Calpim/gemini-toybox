import { describe, expect, it } from 'vitest';
import { createGameState, stepGame } from './engine';
import type { GameState, Vec2 } from './types';

const GOLDEN_DIR_URL = new URL('./__golden__/', import.meta.url);
const GOLDEN_FILE_URL = new URL('./__golden__/golden-snapshot.json', import.meta.url);

const DT = 1 / 60;
const FRAMES = 600;

interface NodeFs {
  existsSync(path: URL): boolean;
  mkdirSync(path: URL, options: { recursive: boolean }): void;
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string, encoding: 'utf8'): void;
}

async function loadNodeFs(): Promise<NodeFs> {
  const specifier = 'node:fs';
  return (await import(/* @vite-ignore */ specifier)) as NodeFs;
}

function shouldUpdateGolden(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.UPDATE_GOLDEN === '1';
}

interface GoldenScenario {
  readonly name: string;
  readonly seed: number;
  readonly startFloor: number;
  readonly frames: number;
}

const SCENARIOS: readonly GoldenScenario[] = [
  { name: 'floor1-seed101', seed: 101, startFloor: 1, frames: FRAMES },
  { name: 'floor2-seed202', seed: 202, startFloor: 2, frames: FRAMES },
  { name: 'floor3-seed303', seed: 303, startFloor: 3, frames: FRAMES },
];

const INPUT_DIRECTIONS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

function getDeterministicInput(frame: number): Vec2 {
  const index = Math.floor(frame / 60) % INPUT_DIRECTIONS.length;
  const dir = INPUT_DIRECTIONS[index];
  if (!dir) {
    throw new Error(`Invalid input direction index: ${index}`);
  }
  return dir;
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

function countBySorted<T>(items: readonly T[], getKey: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted: Record<string, number> = {};
  for (const key of [...counts.keys()].sort()) {
    sorted[key] = counts.get(key) ?? 0;
  }
  return sorted;
}

interface GoldenSummary {
  floor: number;
  status: GameState['status'];
  player: {
    hp: number;
    maxHp: number;
    x: number;
    y: number;
    level: number;
    exp: number;
    expToNext: number;
    skillPoints: number;
  };
  stats: {
    kills: number;
    floorsCleared: number;
    totalExp: number;
    chestsOpened: number;
    elapsedPlayTime: number;
  };
  enemies: Array<{
    id: number;
    kind: string;
    hp: number;
    maxHp: number;
    x: number;
    y: number;
  }>;
  projectiles: {
    count: number;
    byKind: Record<string, number>;
  };
  enemyProjectiles: {
    count: number;
  };
  pickups: {
    count: number;
    byKind: Record<string, number>;
  };
  nextEntityId: number;
}

function summarizeState(state: GameState): GoldenSummary {
  const enemies = [...state.enemies]
    .sort((a, b) => a.id - b.id)
    .map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind ?? 'normal',
      hp: round3(enemy.hp),
      maxHp: round3(enemy.maxHp),
      x: round3(enemy.x),
      y: round3(enemy.y),
    }));

  return {
    floor: state.floor,
    status: state.status,
    player: {
      hp: round3(state.player.hp),
      maxHp: round3(state.player.maxHp),
      x: round3(state.player.x),
      y: round3(state.player.y),
      level: state.player.level,
      exp: round3(state.player.exp),
      expToNext: round3(state.player.expToNext),
      skillPoints: state.player.skillPoints,
    },
    stats: {
      kills: state.stats.kills,
      floorsCleared: state.stats.floorsCleared,
      totalExp: round3(state.stats.totalExp),
      chestsOpened: state.stats.chestsOpened,
      elapsedPlayTime: round3(state.stats.elapsedPlayTime),
    },
    enemies,
    projectiles: {
      count: state.projectiles.length,
      byKind: countBySorted(state.projectiles, (p) => p.kind ?? 'base'),
    },
    enemyProjectiles: {
      count: state.enemyProjectiles.length,
    },
    pickups: {
      count: state.pickups.length,
      byKind: countBySorted(state.pickups, (p) => p.kind),
    },
    nextEntityId: state.nextEntityId,
  };
}

function runScenario(scenario: GoldenScenario): GoldenSummary {
  const state = createGameState({
    seed: scenario.seed,
    startFloor: scenario.startFloor,
  });

  for (let frame = 0; frame < scenario.frames; frame++) {
    stepGame(state, getDeterministicInput(frame), DT);
  }

  return summarizeState(state);
}

describe('Golden behavior snapshots', () => {
  it('matches committed golden snapshot for deterministic 600-frame scenarios', async () => {
    const fs = await loadNodeFs();
    const actual: Record<string, GoldenSummary> = {};
    for (const scenario of SCENARIOS) {
      actual[scenario.name] = runScenario(scenario);
    }

    if (shouldUpdateGolden()) {
      fs.mkdirSync(GOLDEN_DIR_URL, { recursive: true });
      fs.writeFileSync(GOLDEN_FILE_URL, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
      return;
    }

    if (!fs.existsSync(GOLDEN_FILE_URL)) {
      throw new Error(
        `Golden snapshot not found at ${GOLDEN_FILE_URL.pathname}. Run "UPDATE_GOLDEN=1 npx vitest run src/game/golden.test.ts" to generate it.`,
      );
    }

    const expected = JSON.parse(fs.readFileSync(GOLDEN_FILE_URL, 'utf8')) as Record<string, GoldenSummary>;
    expect(actual).toEqual(expected);
  });
});
