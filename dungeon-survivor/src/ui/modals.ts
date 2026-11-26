import type { GameState } from '../game/types';
import { renderEquipChoiceModal } from './modals/equipChoiceModal';
import { getOrCreatePopoverController } from './modals/popover';
import { renderSkillModal } from './modals/skillModal';
import type { ModalElements, ModalHandlers } from './modals/types';

export { closeOpenSkillInfoPopover, computePopoverPosition } from './modals/popover';
export type { ModalElements, ModalHandlers, PauseModalTab } from './modals/types';

export function renderModals(state: GameState, els: ModalElements, handlers: ModalHandlers): void {
  const ctrl = getOrCreatePopoverController(els.skillModal);
  ctrl.state = state;
  renderSkillModal(state, els, handlers, ctrl);
  renderEquipChoiceModal(state, els, handlers);
}
