import type { ModeConfig } from '@truco/shared';
import { fixedManilhaLadder } from './paulista';

/** Truco Mineiro: baralho limpo, sem vira, manilhas fixas e mão valendo 2. */
export function createMineiro(): ModeConfig {
  return {
    id: 'mineiro',
    name: 'Truco Mineiro',
    variant: 'manilha fixa',
    deck: { kind: 'frances', removedRanks: ['8', '9', '10'], jokers: 0 },
    strength: { kind: 'fixa', ladder: fixedManilhaLadder(false, false) },
    baseHandValue: 2,
    // Valores mais comuns; variam por região, então a sala poderá trocar.
    trucoLadder: [
      { name: 'Truco', value: 4 },
      { name: 'Seis', value: 8 },
      { name: 'Nove', value: 10 },
      { name: 'Doze', value: 12 },
    ],
    pointsToWin: 12,
    special: { maoDeOnze: true, maoDeFerro: true, cartaCoberta: true, sinaisPermitidos: false },
    tieRule: 'brasileiro',
  };
}
