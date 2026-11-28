import { getPlayerBaseAttackStats } from '../../game/engine';
import {
  EQUIPMENT_CATALOG,
  type EquippedItem,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getEquipmentEvolutionSummary,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getScrapExpandCost,
  getSeekerDroneRange,
  MAX_EQUIP_SLOTS_CAP,
  MAX_EQUIPMENT_LEVEL,
  MAX_TARGET_RANGE,
} from '../../game/equipment';
import { computeSkillModifiers, getSkillLevel } from '../../game/skillTree';
import type { GameState } from '../../game/types';

function getEquipmentNumericChips(eq: EquippedItem, state: GameState): string[] {
  const def = EQUIPMENT_CATALOG[eq.id];
  const mods = computeSkillModifiers(state.player.skillLevels);
  const dmg = Math.round(getEquipmentDamage(eq, 1));
  const cdMult = getEquipmentCooldownMultiplier(eq.level);

  if (eq.id === 'orbit_shield') {
    const r = Math.round(getOrbitShieldRadius(eq.level, mods.rangeMult));
    return [`威力 ${dmg}`, `半径 ${r}px`];
  }
  const cdSec = (def.baseCooldown * cdMult).toFixed(2);
  let actualRange = def.baseRange * mods.rangeMult;
  if (eq.id === 'pulse_blade') {
    actualRange = getPulseBladeStats(eq.level, def.baseRange, mods.rangeMult).range;
  } else if (eq.id === 'seeker_drone') {
    actualRange = getSeekerDroneRange(eq.level, def.baseRange, mods.rangeMult);
  } else if (eq.id === 'reactive_coil') {
    actualRange = getReactiveCoilStats(eq.level, def.baseRange, mods.rangeMult).range;
  } else if (eq.id === 'ricochet_disc') {
    actualRange = getRicochetDiscStats(eq.level, mods.rangeMult).range;
  }
  const cappedRange = Math.round(Math.min(MAX_TARGET_RANGE, actualRange));
  return [`威力 ${dmg}`, `${cdSec}s`, `射程 ${cappedRange}px`];
}

export function renderGearTabContent(container: HTMLElement, state: GameState): void {
  const { player } = state;
  const mods = computeSkillModifiers(player.skillLevels);
  const isMaxSlots = player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP;
  const expandCost = getScrapExpandCost(player.maxEquipSlots, mods.scrapExpandDiscount);
  const progress = isMaxSlots
    ? 100
    : Math.min(100, Math.round((player.scrapExpandProgress / Math.max(1, expandCost)) * 100));
  const remaining = Math.max(0, expandCost - player.scrapExpandProgress);

  const scrapTitleRight = isMaxSlots
    ? `枠 ${player.maxEquipSlots} / ${MAX_EQUIP_SLOTS_CAP}（最大拡張済み）`
    : `枠 ${player.maxEquipSlots} / ${MAX_EQUIP_SLOTS_CAP}（蓄積 ${player.scrapExpandProgress} / ${expandCost}）`;

  const scrapHint = isMaxSlots
    ? `装備枠は最大（${MAX_EQUIP_SLOTS_CAP}枠）に到達しています。満杯時や+2Lv以上の重複ドロップ時は既存装備のLv+1や入れ替えに活用できます。`
    : `満杯状態や+2Lv以上の重複ドロップ時に「枠拡張へ蓄積」を選ぶと、あと <strong>${remaining}回</strong> で装備枠が +1 されます（他装備Lv+1や入れ替えも選択可能）。`;

  const baseStats = getPlayerBaseAttackStats(player);
  const ocLv = getSkillLevel(player.skillLevels, 'arm_overclock');
  const mainBadge = ocLv > 0 ? `レーザー化 Lv${ocLv}` : `メイン武器`;
  const homingLabel = baseStats.homingShots > 0 ? ` + 誘導${baseStats.homingShots}発` : '';
  const pierceChip = baseStats.pierce ? `<span class="stat-chip" style="color:#67e8f9">貫通</span>` : '';

  const subCards: string[] = [];
  for (let i = 0; i < player.maxEquipSlots; i++) {
    const eq = player.equipment[i];
    if (eq) {
      const def = EQUIPMENT_CATALOG[eq.id];
      const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
      const lvLabel =
        eq.level >= MAX_EQUIPMENT_LEVEL
          ? `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} MAX`
          : `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL}`;
      const chipsHtml = getEquipmentNumericChips(eq, state)
        .map((c) => `<span class="stat-chip">${c}</span>`)
        .join('');
      subCards.push(`
        <div class="sub-gear-card" style="--card-accent:${def.color}88">
          <div class="gear-cat" style="color:${def.color}">${def.category}</div>
          <div class="gear-card-head">
            <span class="gear-name">${def.name}</span>
            <span class="gear-lv" style="color:${def.color}">${lvLabel}</span>
          </div>
          <div class="gear-evo">進化: ${evo}</div>
          <div class="gear-stats">${chipsHtml}</div>
        </div>
      `);
    } else {
      subCards.push(`
        <div class="sub-gear-card empty">
          <div>
            <div class="gear-cat">SLOT ${i + 1} / ${player.maxEquipSlots}</div>
            <div style="font-size:13.5px;font-weight:700;color:#94a3b8">EMPTY SLOT</div>
            <div style="font-size:11px">宝箱やボスドロップで自動装着</div>
          </div>
          <span class="gear-lv">空き枠</span>
        </div>
      `);
    }
  }

  container.innerHTML = `
    <div class="scrap-panel">
      <div class="scrap-top">
        <span class="scrap-title">スクラップ＆ビルド（枠拡張進捗）</span>
        <span class="scrap-count">${scrapTitleRight}</span>
      </div>
      <div class="scrap-bar-track"><div class="scrap-bar-fill" style="width:${progress}%"></div></div>
      <div class="scrap-hint">${scrapHint}</div>
    </div>

    <div class="gear-section-kicker">MAIN WEAPON（常時装備）</div>
    <div class="main-weapon-card">
      <div class="gear-card-head">
        <span class="gear-name" style="color:#6ee7b7">コアショット（メイン武器）</span>
        <span class="gear-lv" style="color:#34d399;border-color:rgba(52,211,153,0.5)">${mainBadge}</span>
      </div>
      <div class="gear-stats">
        <span class="stat-chip">威力 ${baseStats.damage}</span>
        <span class="stat-chip">${baseStats.shotCount}発${homingLabel}</span>
        <span class="stat-chip">${baseStats.cooldown.toFixed(2)}s</span>
        <span class="stat-chip">射程 ${baseStats.range}px</span>
        ${pierceChip}
      </div>
    </div>

    <div class="gear-section-kicker">SUB EQUIPMENT SLOTS（${player.equipment.length} / ${player.maxEquipSlots} 装着中）</div>
    <div class="gear-grid">${subCards.join('')}</div>
  `;
}
