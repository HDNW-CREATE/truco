import type { CardPattern, ModeConfig, Rank } from '@truco/shared';

export interface PaulistaOptions {
  /** Sujo: com 8, 9 e 10 no baralho. */
  sujo?: boolean;
  /** Com coringa: carta mais forte, acima do zap. */
  coringa?: boolean;
  /** Manilha velha: sem vira, com as manilhas fixas do Mineiro. */
  manilhaVelha?: boolean;
}

/** Ordem das cartas comuns, da menor para a maior. */
export function paulistaCommonOrder(sujo: boolean): Rank[] {
  return sujo
    ? ['4', '5', '6', '7', '8', '9', '10', 'Q', 'J', 'K', 'A', '2', '3']
    : ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
}

/** Escada das manilhas fixas (zap, copas, espadilha, pica-fumo) e depois as comuns. */
export function fixedManilhaLadder(sujo: boolean, coringa: boolean): CardPattern[][] {
  const common = [...paulistaCommonOrder(sujo)].reverse().map((rank) => [{ rank }]);
  const ladder: CardPattern[][] = [
    [{ rank: '4', suit: 'paus' }],
    [{ rank: '7', suit: 'copas' }],
    [{ rank: 'A', suit: 'espadas' }],
    [{ rank: '7', suit: 'ouros' }],
    ...common,
  ];
  return coringa ? [[{ rank: 'CORINGA' }], ...ladder] : ladder;
}

export function createPaulista(options: PaulistaOptions = {}): ModeConfig {
  const sujo = options.sujo ?? false;
  const coringa = options.coringa ?? false;
  const manilhaVelha = options.manilhaVelha ?? false;

  const labels = [sujo ? 'sujo' : 'limpo'];
  if (coringa) labels.push('com coringa');
  if (manilhaVelha) labels.push('manilha velha');

  return {
    id: 'paulista',
    name: 'Truco Paulista',
    variant: labels.join(', '),
    deck: {
      kind: 'frances',
      removedRanks: sujo ? [] : ['8', '9', '10'],
      jokers: coringa ? 1 : 0,
    },
    strength: manilhaVelha
      ? { kind: 'fixa', ladder: fixedManilhaLadder(sujo, coringa) }
      : {
          kind: 'vira',
          commonOrder: paulistaCommonOrder(sujo),
          manilhaSuitOrder: ['ouros', 'espadas', 'copas', 'paus'],
        },
    baseHandValue: 1,
    trucoLadder: [
      { name: 'Truco', value: 3 },
      { name: 'Seis', value: 6 },
      { name: 'Nove', value: 9 },
      { name: 'Doze', value: 12 },
    ],
    pointsToWin: 12,
    special: { maoDeOnze: true, maoDeFerro: true, cartaCoberta: true, sinaisPermitidos: false },
    tieRule: 'brasileiro',
  };
}
