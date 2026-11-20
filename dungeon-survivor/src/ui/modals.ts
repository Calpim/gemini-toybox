import { getPlayerBaseAttackStats, type EquipChoice } from '../game/engine';
import {
  EQUIPMENT_CATALOG,
  MAX_EQUIPMENT_LEVEL,
  MAX_EQUIP_SLOTS_CAP,
  MAX_TARGET_RANGE,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getEquipmentEvolutionSummary,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getScrapExpandCost,
  getSeekerDroneRange,
  type EquippedItem,
} from '../game/equipment';
import {
  SKILL_PREREQ_LEVEL,
  SKILL_TREE_NODES,
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillEffectSummary,
  getSkillLevel,
  getSkillMaxLevel,
  getSkillNode,
  getSkillUpgradeCost,
  type SkillBranch,
  type SkillNodeId,
} from '../game/skillTree';
import type { GameState } from '../game/types';

export interface ModalHandlers {
  onUnlockSkill: (nodeId: SkillNodeId) => void;
  onCloseSkillTree: () => void;
  onResolveEquip: (choice: EquipChoice) => void;
}

const BRANCH_META: { id: SkillBranch; label: string; accent: string }[] = [
  { id: 'arms', label: '🔴 兵装・ビット', accent: '#f87171' },
  { id: 'defense', label: '🔵 迎撃・防衛', accent: '#60a5fa' },
  { id: 'mobility', label: '🟢 探索・機動', accent: '#34d399' },
];

function formatGearDetail(eq: EquippedItem, state: GameState): string {
  const def = EQUIPMENT_CATALOG[eq.id];
  const mods = computeSkillModifiers(state.player.skillLevels);
  const dmg = Math.round(getEquipmentDamage(eq, 1));
  const cdMult = getEquipmentCooldownMultiplier(eq.level);
  const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
  const lvTag =
    eq.level >= MAX_EQUIPMENT_LEVEL
      ? `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} MAX`
      : `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL}`;

  if (eq.id === 'orbit_shield') {
    const r = Math.round(getOrbitShieldRadius(eq.level, mods.rangeMult));
    return `${def.name} ${lvTag}｜威力${dmg}｜半径${r}px (${evo})`;
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
  return `${def.name} ${lvTag}｜威力${dmg} / ${cdSec}s / 射程${cappedRange}px (${evo})`;
}

export function renderModals(
  state: GameState,
  els: {
    skillModal: HTMLElement;
    skillSpBadge: HTMLElement;
    skillColumns: HTMLElement;
    skillGearSummary: HTMLElement;
    equipModal: HTMLElement;
    equipDropCard: HTMLElement;
    equipSlotList: HTMLElement;
  },
  handlers: ModalHandlers
): void {
  // 1. Pause & Skill Tree Modal
  if (state.status === 'skill_tree') {
    els.skillModal.classList.remove('hidden');
    els.skillSpBadge.textContent = `所持 SP: ${state.player.skillPoints} (使用済 ${state.player.spentSkillPoints})`;

    els.skillColumns.innerHTML = '';
    for (const branch of BRANCH_META) {
      const col = document.createElement('div');
      col.className = 'tree-col';

      const heading = document.createElement('div');
      heading.className = 'tree-col-head';
      heading.style.color = branch.accent;
      heading.textContent = branch.label;
      col.appendChild(heading);

      const nodes = SKILL_TREE_NODES.filter((n) => n.branch === branch.id).sort(
        (a, b) => a.tier - b.tier
      );
      nodes.forEach((node, idx) => {
        if (idx > 0) {
          const arrow = document.createElement('div');
          arrow.className = 'tree-arrow';
          arrow.textContent = `↓ 前提 Lv${SKILL_PREREQ_LEVEL}+`;
          col.appendChild(arrow);
        }

        const currLv = getSkillLevel(state.player.skillLevels, node.id);
        const maxLv = getSkillMaxLevel(node.id);
        const isMax = currLv >= maxLv;
        const nextCost = getSkillUpgradeCost(currLv, node.id);
        const isAvailable = canUpgradeSkill(
          state.player.skillLevels,
          state.player.skillPoints,
          node.id
        );
        const prereqMet =
          node.requires === null ||
          getSkillLevel(state.player.skillLevels, node.requires) >= SKILL_PREREQ_LEVEL;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tree-node ${
          isMax ? 'unlocked' : isAvailable ? 'available' : currLv > 0 ? 'unlocked' : 'locked'
        }`;
        btn.disabled = !isAvailable;

        const costPattern =
          node.tier === 3
            ? 'Lv1:2 / Lv2:3'
            : node.tier === 1
              ? 'Lv1-4:1 / Lv5:2'
              : 'Lv1-3:1 / Lv4:2 / Lv5:3';
        const costLabel = isMax ? 'MAX' : `次Lv必要 ${nextCost} SP（${costPattern}）`;
        const reqLabel = node.requires
          ? `Tier ${node.tier} · ${costLabel} · 前提: ${getSkillNode(node.requires).name} Lv${SKILL_PREREQ_LEVEL}+`
          : `Tier ${node.tier} · ${costLabel} · 基本ノード`;

        const stateLabel = isMax
          ? `MAX (${currLv}/${maxLv})`
          : isAvailable
          ? currLv === 0
            ? `習得 (-${nextCost} SP)`
            : `Lv${currLv}→${currLv + 1} (-${nextCost} SP)`
          : prereqMet
          ? `🔒 SP不足 (必要${nextCost})`
          : `🔒 前提Lv${SKILL_PREREQ_LEVEL}要`;

        const effectText =
          currLv > 0
            ? `${node.description} ｜ 現在: ${getSkillEffectSummary(node.id, currLv)}`
            : node.description;

        btn.innerHTML = `
          <div class="node-top">
            <strong>${node.name} <span style="opacity:0.8;font-size:11px">Lv${currLv}/${maxLv}</span></strong>
            <span class="node-state">${stateLabel}</span>
          </div>
          <div class="node-desc">${effectText}</div>
          <div class="node-req">${reqLabel}</div>
        `;

        if (isAvailable) {
          btn.addEventListener('click', () => handlers.onUnlockSkill(node.id));
        }
        col.appendChild(btn);
      });

      els.skillColumns.appendChild(col);
    }

    const expandCost = getScrapExpandCost(state.player.maxEquipSlots);
    const expandProgressLabel =
      state.player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP
        ? '枠拡張最大'
        : `拡張蓄積 ${state.player.scrapExpandProgress}/${expandCost}`;
    const baseStats = getPlayerBaseAttackStats(state.player);
    const slotPill = `<span class="gear-pill" style="border-color:#94a3b855;color:#cbd5e1">サブ装備枠 ${state.player.equipment.length}/${state.player.maxEquipSlots} (上限${MAX_EQUIP_SLOTS_CAP} / ${expandProgressLabel})</span>`;
    const pierceTag = baseStats.pierce ? ' / 貫通' : '';
    const homingTag = baseStats.homingShots > 0 ? ` + 誘導${baseStats.homingShots}発` : '';
    const basePill = `<span class="gear-pill" style="border-color:#34d39988;color:#6ee7b7">メイン武器 (コアショット): 威力${baseStats.damage} / ${baseStats.shotCount}発${homingTag} / ${baseStats.cooldown.toFixed(2)}s / 射程${baseStats.range}px${pierceTag}</span>`;
    const gearPills =
      state.player.equipment.length === 0
        ? `<span style="font-size:12px;color:#94a3b8;">（宝箱や敵ドロップでサブ装備を追加可能）</span>`
        : state.player.equipment
            .map((eq) => {
              const def = EQUIPMENT_CATALOG[eq.id];
              return `<span class="gear-pill" style="border-color:${def.color}55;color:${def.color}">${formatGearDetail(eq, state)}</span>`;
            })
            .join('');
    els.skillGearSummary.innerHTML = `${slotPill}${basePill}${gearPills}`;
  } else {
    els.skillModal.classList.add('hidden');
  }

  // 2. Equipment Choice Modal (when slots === maxEquipSlots)
  if (state.status === 'equip_choice' && state.pendingEquipDrop) {
    els.equipModal.classList.remove('hidden');
    const titleEl = document.getElementById('equipModalTitle');
    if (titleEl) {
      titleEl.textContent = `📦 装備スロット満杯（${state.player.equipment.length}/${state.player.maxEquipSlots}）`;
    }
    const scrapExpandBtn = document.getElementById('scrapEquipBtn') as HTMLButtonElement | null;
    if (scrapExpandBtn) {
      const canExpand = state.player.maxEquipSlots < MAX_EQUIP_SLOTS_CAP;
      const expandCost = getScrapExpandCost(state.player.maxEquipSlots);
      scrapExpandBtn.disabled = !canExpand;
      scrapExpandBtn.textContent = canExpand
        ? `🔧 スクラップ＆ビルド：枠拡張へ蓄積（${state.player.scrapExpandProgress}/${expandCost}）→ ${expandCost}回で枠+1`
        : `🔧 装備枠は最大（${MAX_EQUIP_SLOTS_CAP}/${MAX_EQUIP_SLOTS_CAP}）`;
    }

    const dropItem = state.pendingEquipDrop.item;
    const dropDef = EQUIPMENT_CATALOG[dropItem.id];
    const dropEvo = getEquipmentEvolutionSummary(dropItem.id, dropItem.level);
    els.equipDropCard.innerHTML = `
      <div class="drop-badge" style="color:${dropDef.color}">${dropDef.category}</div>
      <div class="drop-name">${dropDef.name} Lv${dropItem.level} <span style="font-size:12px;color:#fbbf24;">[${dropEvo}]</span></div>
      <div class="drop-desc">${dropDef.description}</div>
    `;

    els.equipSlotList.innerHTML = '';
    state.player.equipment.forEach((eq, idx) => {
      const def = EQUIPMENT_CATALOG[eq.id];
      const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
      const isMaxLv = eq.level >= MAX_EQUIPMENT_LEVEL;
      const row = document.createElement('div');
      row.className = 'slot-btn';
      row.style.cursor = 'default';
      row.innerHTML = `
        <span><strong>枠${idx + 1}/${state.player.maxEquipSlots}</strong> ${def.name} Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} <small style="color:#94a3b8">(${evo})</small></span>
      `;
      const actions = document.createElement('span');
      actions.style.display = 'inline-flex';
      actions.style.gap = '6px';

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'slot-action';
      replaceBtn.style.border = '1px solid #38bdf866';
      replaceBtn.style.background = '#0f172a';
      replaceBtn.style.borderRadius = '6px';
      replaceBtn.style.padding = '4px 8px';
      replaceBtn.style.cursor = 'pointer';
      replaceBtn.textContent = '入れ替える';
      replaceBtn.addEventListener('click', () => handlers.onResolveEquip({ type: 'replace', slotIndex: idx }));

      const upgradeBtn = document.createElement('button');
      upgradeBtn.type = 'button';
      upgradeBtn.className = 'slot-action';
      upgradeBtn.style.border = '1px solid #fbbf2466';
      upgradeBtn.style.color = '#fbbf24';
      upgradeBtn.style.background = '#0f172a';
      upgradeBtn.style.borderRadius = '6px';
      upgradeBtn.style.padding = '4px 8px';
      if (isMaxLv) {
        upgradeBtn.disabled = true;
        upgradeBtn.style.opacity = '0.45';
        upgradeBtn.style.cursor = 'not-allowed';
        upgradeBtn.textContent = `MAX (Lv${MAX_EQUIPMENT_LEVEL})`;
      } else {
        upgradeBtn.style.cursor = 'pointer';
        upgradeBtn.textContent = `Lv+1 (${eq.level}→${eq.level + 1})`;
        upgradeBtn.addEventListener('click', () =>
          handlers.onResolveEquip({ type: 'scrap_upgrade', slotIndex: idx })
        );
      }

      actions.appendChild(replaceBtn);
      actions.appendChild(upgradeBtn);
      row.appendChild(actions);
      els.equipSlotList.appendChild(row);
    });
  } else {
    els.equipModal.classList.add('hidden');
  }
}
