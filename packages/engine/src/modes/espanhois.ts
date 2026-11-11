import type { BetStep, CardPattern, ModeConfig } from '@truco/shared';

/** Hierarquia fixa do baralho espanhol, da maior para a menor. */
export const SPANISH_LADDER: CardPattern[][] = [
  [{ rank: '1', suit: 'espadas' }],
  [{ rank: '1', suit: 'paus' }],
  [{ rank: '7', suit: 'espadas' }],
  [{ rank: '7', suit: 'ouros' }],
  [{ rank: '3' }],
  [{ rank: '2' }],
  [{ rank: '1' }],
  [{ rank: '12' }],
  [{ rank: '11' }],
  [{ rank: '10' }],
  [{ rank: '7' }],
  [{ rank: '6' }],
  [{ rank: '5' }],
  [{ rank: '4' }],
];

const TRUCO_LADDER: BetStep[] = [
  { name: 'Truco', value: 2 },
  { name: 'Retruco', value: 3 },
  { name: 'Vale Quatro', value: 4 },
];

const ENVIDO_STEPS: BetStep[] = [
  { name: 'Envido', value: 2, maxRepeat: 2 },
  { name: 'Real Envido', value: 3 },
];

export interface GauderioOptions {
  flor?: boolean;
  pointsToWin?: 24 | 30;
  sinais?: boolean;
}

export function createGauderio(options: GauderioOptions = {}): ModeConfig {
  const flor = options.flor ?? true;
  return {
    id: 'gauderio',
    name: 'Truco Gaudério',
    variant: flor ? 'com flor' : 'sem flor',
    deck: { kind: 'espanhol', removedRanks: [], jokers: 0 },
    strength: { kind: 'fixa', ladder: SPANISH_LADDER },
    baseHandValue: 1,
    trucoLadder: TRUCO_LADDER,
    pointsToWin: options.pointsToWin ?? 30,
    envido: { steps: ENVIDO_STEPS, faltaName: 'Falta Envido', malasBuenas: false },
    ...(flor ? { flor: { value: 3, mandatory: false, contraflor: true } } : {}),
    special: {
      maoDeOnze: false,
      maoDeFerro: false,
      cartaCoberta: false,
      sinaisPermitidos: options.sinais ?? true,
    },
    tieRule: 'rioplatense',
  };
}

export interface EspanholOptions {
  flor?: boolean;
  pointsToWin?: 15 | 30;
  sinais?: boolean;
}

/** Truco Espanhol (estilo argentino): malas/buenas e pica-pica no 3x3. */
export function createEspanhol(options: EspanholOptions = {}): ModeConfig {
  const flor = options.flor ?? false;
  return {
    id: 'espanhol',
    name: 'Truco Espanhol',
    variant: flor ? 'com flor' : 'sem flor',
    deck: { kind: 'espanhol', removedRanks: [], jokers: 0 },
    strength: { kind: 'fixa', ladder: SPANISH_LADDER },
    baseHandValue: 1,
    trucoLadder: TRUCO_LADDER,
    pointsToWin: options.pointsToWin ?? 30,
    envido: { steps: ENVIDO_STEPS, faltaName: 'Falta Envido', malasBuenas: true },
    ...(flor ? { flor: { value: 3, mandatory: false, contraflor: true } } : {}),
    special: {
      maoDeOnze: false,
      maoDeFerro: false,
      cartaCoberta: false,
      picaPica: { from: 5, to: 25 },
      sinaisPermitidos: options.sinais ?? true,
    },
    tieRule: 'rioplatense',
  };
}

/** Truco Uruguaio: muestra virada na mesa, piezas e flor obrigatória. */
export function createUruguaio(options: { pointsToWin?: 30 | 40 } = {}): ModeConfig {
  return {
    id: 'uruguaio',
    name: 'Truco Uruguaio',
    variant: 'com muestra',
    deck: { kind: 'espanhol', removedRanks: [], jokers: 0 },
    strength: {
      kind: 'muestra',
      piezaRanks: ['2', '4', '5', '11', '10'],
      ladder: SPANISH_LADDER,
    },
    baseHandValue: 1,
    trucoLadder: TRUCO_LADDER,
    pointsToWin: options.pointsToWin ?? 30,
    envido: {
      steps: ENVIDO_STEPS,
      faltaName: 'Falta Envido',
      malasBuenas: true,
      piezaValues: { '2': 30, '4': 29, '5': 28, '11': 27, '10': 27 },
    },
    flor: { value: 3, mandatory: true, contraflor: true },
    special: {
      maoDeOnze: false,
      maoDeFerro: false,
      cartaCoberta: false,
      sinaisPermitidos: true,
    },
    tieRule: 'rioplatense',
  };
}

/**
 * Truc Valenciano (regras aproximadas e configuráveis): baralho reduzido a 22 cartas,
 * envit no lugar do envido, sem flor, e Joc Fora valendo a partida.
 * A partida vai a 24 pedras (duas camas de 12).
 */
export function createValenciano(options: { pointsToWin?: number } = {}): ModeConfig {
  return {
    id: 'valenciano',
    name: 'Truc Valenciano',
    variant: '22 cartas',
    deck: {
      kind: 'espanhol',
      removedRanks: ['2', '10', '11', '12'],
      removedCards: [
        { rank: '1', suit: 'ouros' },
        { rank: '1', suit: 'copas' },
      ],
      jokers: 0,
    },
    strength: {
      kind: 'fixa',
      ladder: [
        [{ rank: '1', suit: 'espadas' }],
        [{ rank: '1', suit: 'paus' }],
        [{ rank: '7', suit: 'espadas' }],
        [{ rank: '7', suit: 'ouros' }],
        [{ rank: '3' }],
        [{ rank: '7' }],
        [{ rank: '6' }],
        [{ rank: '5' }],
        [{ rank: '4' }],
      ],
    },
    baseHandValue: 1,
    trucoLadder: [
      { name: 'Truc', value: 2 },
      { name: 'Retruc', value: 3 },
      { name: 'Quatre Val', value: 4 },
      { name: 'Joc Fora', value: 'partida' },
    ],
    pointsToWin: options.pointsToWin ?? 24,
    envido: {
      steps: [
        { name: 'Envit', value: 2 },
        { name: 'Torne a envidar', value: 2 },
      ],
      faltaName: 'Falta Envit',
      malasBuenas: true,
    },
    special: {
      maoDeOnze: false,
      maoDeFerro: false,
      cartaCoberta: false,
      sinaisPermitidos: true,
    },
    tieRule: 'rioplatense',
  };
}
