import {
  EQUIPMENT_CATALOG,
  getEquipmentEvolutionSummary,
  getScrapExpandCost,
  MAX_EQUIP_SLOTS_CAP,
  MAX_EQUIPMENT_LEVEL,
} from '../../game/equipment';
import type { GameState } from '../../game/types';
import type { ModalElements, ModalHandlers } from './types';

export function renderEquipChoiceModal(state: GameState, els: ModalElements, handlers: ModalHandlers): void {
  // 2. Equipment Choice Modal (when slots === maxEquipSlots or +2Lv+ higher duplicate drop)
  if (state.status === 'equip_choice' && state.pendingEquipDrop) {
    els.equipModal.classList.remove('hidden');
    const dropItem = state.pendingEquipDrop.item;
    const dropDef = EQUIPMENT_CATALOG[dropItem.id];
    const dropEvo = getEquipmentEvolutionSummary(dropItem.id, dropItem.level);
    const existingItem = state.player.equipment.find((eq) => eq.id === dropItem.id);
    const isDuplicateDrop = existingItem !== undefined;
    const existingLv = existingItem ? existingItem.level : 0;
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
        isDuplicateDrop && isSameEquipment ? `<span class="slot-match-tag">所持中・入替で+${levelDiff}Lv</span>` : '';
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
        replaceBtn.textContent = isDuplicateDrop ? `入れ替える (Lv${eq.level}→Lv${dropItem.level})` : '入れ替える';
        replaceBtn.addEventListener('click', () => handlers.onResolveEquip({ type: 'replace', slotIndex: idx }));
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
        upgradeBtn.addEventListener('click', () => handlers.onResolveEquip({ type: 'scrap_upgrade', slotIndex: idx }));
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
