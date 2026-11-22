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
import { ICON_GEAR, ICON_LOCK, ICON_TREE } from './icons';

export type PauseModalTab = 'skill' | 'gear';

export interface ModalHandlers {
  onUnlockSkill: (nodeId: SkillNodeId) => void;
  onCloseSkillTree: () => void;
  onResolveEquip: (choice: EquipChoice) => void;
  activeTab?: PauseModalTab;
}

const BRANCH_META: { id: SkillBranch; label: string; accent: string }[] = [
  { id: 'arms', label: '兵装・ビット', accent: '#f87171' },
  { id: 'defense', label: '迎撃・防衛', accent: '#60a5fa' },
  { id: 'mobility', label: '探索・機動', accent: '#34d399' },
];

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

function formatGearDetail(eq: EquippedItem, state: GameState): string {
  const def = EQUIPMENT_CATALOG[eq.id];
  const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
  const lvTag =
    eq.level >= MAX_EQUIPMENT_LEVEL
      ? `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} MAX`
      : `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL}`;
  const chips = getEquipmentNumericChips(eq, state).join(' / ');
  return `${def.name} ${lvTag}｜${chips} (${evo})`;
}

function renderGearTabContent(container: HTMLElement, state: GameState): void {
  const { player } = state;
  const isMaxSlots = player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP;
  const expandCost = getScrapExpandCost(player.maxEquipSlots);
  const progress = isMaxSlots ? 100 : Math.min(100, Math.round((player.scrapExpandProgress / Math.max(1, expandCost)) * 100));
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
      const lvLabel = eq.level >= MAX_EQUIPMENT_LEVEL ? `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} MAX` : `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL}`;
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

export function renderModals(
  state: GameState,
  els: {
    skillModal: HTMLElement;
    skillSpBadge: HTMLElement;
    skillColumns: HTMLElement;
    skillGearSummary: HTMLElement;
    skillTabBody?: HTMLElement;
    gearTabBody?: HTMLElement;
    tabSkillBtn?: HTMLElement;
    tabGearBtn?: HTMLElement;
    equipModal: HTMLElement;
    equipDropCard: HTMLElement;
    equipSlotList: HTMLElement;
  },
  handlers: ModalHandlers
): void {
  // 1. Pause Modal (Skill Tree / Gear & Scrap-Build Tabs)
  if (state.status === 'skill_tree') {
    const activeTab: PauseModalTab = handlers.activeTab ?? 'skill';
    els.skillModal.classList.remove('hidden');
    els.skillSpBadge.textContent = `所持 SP: ${state.player.skillPoints} (使用済 ${state.player.spentSkillPoints})`;

    if (els.tabSkillBtn) {
      els.tabSkillBtn.innerHTML = `${ICON_TREE}<span>スキル</span><span class="tab-badge">SP ${state.player.skillPoints}</span>`;
      els.tabSkillBtn.classList.toggle('active-skill', activeTab === 'skill');
      els.tabSkillBtn.setAttribute('aria-selected', String(activeTab === 'skill'));
    }
    if (els.tabGearBtn) {
      els.tabGearBtn.innerHTML = `${ICON_GEAR}<span>装備・ギア</span><span class="tab-badge tab-badge-gear">${state.player.equipment.length} / ${state.player.maxEquipSlots}</span>`;
      els.tabGearBtn.classList.toggle('active-gear', activeTab === 'gear');
      els.tabGearBtn.setAttribute('aria-selected', String(activeTab === 'gear'));
    }
    if (els.skillTabBody && els.gearTabBody) {
      els.skillTabBody.classList.toggle('hidden', activeTab !== 'skill');
      els.gearTabBody.classList.toggle('hidden', activeTab !== 'gear');
      if (activeTab === 'gear') {
        renderGearTabContent(els.gearTabBody, state);
      }
    }

    els.skillColumns.innerHTML = '';
    for (const branch of BRANCH_META) {
      const col = document.createElement('div');
      col.className = 'tree-col';

      const heading = document.createElement('div');
      heading.className = 'tree-col-head';
      heading.style.color = branch.accent;
      heading.innerHTML = `<span class="branch-dot" style="background:${branch.accent};color:${branch.accent}"></span><span>${branch.label}</span>`;
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
        btn.dataset.branch = node.branch;
        btn.dataset.tier = String(node.tier);
        btn.className = `tree-node ${
          isMax ? 'unlocked' : isAvailable ? 'available' : currLv > 0 ? 'unlocked' : 'locked'
        }`;
        btn.disabled = !isAvailable;

        const costPattern =
          node.tier === 3
            ? 'Lv1:2 / Lv2:3'
            : node.tier === 1
              ? 'Lv1-3:1 / Lv4-5:2'
              : 'Lv1-3:1 / Lv4:2 / Lv5:3';
        const costLabel = isMax ? 'MAX' : `次Lv必要 ${nextCost} SP（${costPattern}）`;
        const reqLabel = node.requires
          ? `Tier ${node.tier} · ${costLabel} · 前提: ${getSkillNode(node.requires).name} Lv${SKILL_PREREQ_LEVEL}+`
          : `Tier ${node.tier} · ${costLabel} · 基本ノード`;

        const stateHtml = isMax
          ? `MAX (${currLv}/${maxLv})`
          : isAvailable
          ? currLv === 0
            ? `習得 (-${nextCost} SP)`
            : `Lv${currLv}→${currLv + 1} (-${nextCost} SP)`
          : prereqMet
          ? `${ICON_LOCK}<span>SP不足 (必要${nextCost})</span>`
          : `${ICON_LOCK}<span>前提Lv${SKILL_PREREQ_LEVEL}要</span>`;

        const effectText =
          currLv > 0
            ? `${node.description} ｜ 現在: ${getSkillEffectSummary(node.id, currLv)}`
            : node.description;

        btn.innerHTML = `
          <div class="node-top">
            <span class="node-title">${node.name}<span class="node-lv">Lv${currLv}/${maxLv}</span></span>
            <span class="node-state">${stateHtml}</span>
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

  // 2. Equipment Choice Modal (when slots === maxEquipSlots or +2Lv+ higher duplicate drop)
  if (state.status === 'equip_choice' && state.pendingEquipDrop) {
    els.equipModal.classList.remove('hidden');
    const dropItem = state.pendingEquipDrop.item;
    const dropDef = EQUIPMENT_CATALOG[dropItem.id];
    const dropEvo = getEquipmentEvolutionSummary(dropItem.id, dropItem.level);
    const existingIdx = state.player.equipment.findIndex((eq) => eq.id === dropItem.id);
    const isDuplicateDrop = existingIdx !== -1;
    const existingLv = isDuplicateDrop ? state.player.equipment[existingIdx].level : 0;
    const levelDiff = dropItem.level - existingLv;

    const titleEl = document.getElementById('equipModalTitle');
    if (titleEl) {
      titleEl.textContent = isDuplicateDrop
        ? `⚡ 高Lv重複ドロップ（+${levelDiff}Lv）`
        : `装備スロット満杯（${state.player.equipment.length}/${state.player.maxEquipSlots}）`;
    }
    const reasonEl = document.getElementById('equipModalReason');
    if (reasonEl) {
      reasonEl.classList.toggle('dup', isDuplicateDrop);
      reasonEl.textContent = isDuplicateDrop
        ? `所持中の「${dropDef.name} Lv${existingLv}」より +${levelDiff}Lv 高い装備が出現！一気に入れ替えるか、他装備の強化・枠拡張に回せます。`
        : '装備枠がいっぱいのため、既存装備と入れ替えるか、スクラップにして他装備のLv+1・枠拡張に活用できます。';
    }
    const subLabelEl = document.getElementById('equipModalSubLabel');
    if (subLabelEl) {
      subLabelEl.textContent = isDuplicateDrop
        ? 'または同装備と入れ替え／他装備をLv+1で強化：'
        : 'または既存スロットと入れ替え／スクラップで1個強化：';
    }
    const scrapExpandBtn = document.getElementById('scrapEquipBtn') as HTMLButtonElement | null;
    if (scrapExpandBtn) {
      const canExpand = state.player.maxEquipSlots < MAX_EQUIP_SLOTS_CAP;
      const expandCost = getScrapExpandCost(state.player.maxEquipSlots);
      scrapExpandBtn.disabled = !canExpand;
      scrapExpandBtn.textContent = canExpand
        ? `スクラップ＆ビルド：枠拡張へ蓄積（${state.player.scrapExpandProgress}/${expandCost}）→ ${expandCost}回で枠+1`
        : `装備枠は最大（${MAX_EQUIP_SLOTS_CAP}/${MAX_EQUIP_SLOTS_CAP}）`;
    }

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
      const isSameEquipment = eq.id === dropItem.id;
      const row = document.createElement('div');
      row.className = isDuplicateDrop && isSameEquipment ? 'slot-btn dup-match' : 'slot-btn';
      const matchTag =
        isDuplicateDrop && isSameEquipment
          ? `<span class="slot-match-tag">所持中・入替で+${levelDiff}Lv</span>`
          : '';
      row.innerHTML = `
        <span><strong>枠${idx + 1}/${state.player.maxEquipSlots}</strong> ${def.name} Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} <small style="color:#94a3b8">(${evo})</small>${matchTag}</span>
      `;
      const actions = document.createElement('span');
      actions.style.display = 'inline-flex';
      actions.style.gap = '6px';

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'slot-action';
      if (isDuplicateDrop && !isSameEquipment) {
        replaceBtn.disabled = true;
        replaceBtn.textContent = '重複不可';
      } else {
        replaceBtn.textContent = isDuplicateDrop
          ? `入れ替える (Lv${eq.level}→Lv${dropItem.level})`
          : '入れ替える';
        replaceBtn.addEventListener('click', () =>
          handlers.onResolveEquip({ type: 'replace', slotIndex: idx })
        );
      }

      const upgradeBtn = document.createElement('button');
      upgradeBtn.type = 'button';
      upgradeBtn.className = 'slot-action upgrade';
      if (isMaxLv) {
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = `MAX (Lv${MAX_EQUIPMENT_LEVEL})`;
      } else if (isDuplicateDrop && isSameEquipment) {
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = '入替で強化';
      } else {
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
