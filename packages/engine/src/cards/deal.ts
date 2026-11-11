import type { Card, HandState, ModeConfig, Player, PlayerId } from '@truco/shared';
import { createDeck } from './deck';
import { shuffle } from './rng';

export const CARDS_PER_PLAYER = 3;

/** Jogadores na ordem do jogo (anti-horário), começando pelo lugar indicado. */
export function playersFromSeat(players: readonly Player[], startSeat: number): Player[] {
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const start = sorted.findIndex((p) => p.seat === startSeat);
  if (start < 0) throw new Error(`Lugar ${startSeat} não existe na mesa`);
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

export interface DealResult {
  hand: HandState;
  rngState: number;
}

export interface DealOptions {
  blind?: boolean;
  /** Limita a mão a alguns jogadores (duelos do pica-pica). */
  active?: readonly PlayerId[];
}

/**
 * Mão nova ainda sem cartas: define o mão (quem está depois de quem dá as cartas),
 * a ordem do jogo e o valor inicial. Usada antes de embaralhar e cortar.
 */
export function emptyHand(
  config: ModeConfig,
  players: readonly Player[],
  dealerSeat: number,
  options: DealOptions = {},
): HandState {
  const afterDealer = playersFromSeat(players, (dealerSeat + 1) % players.length);
  const activeIds = options.active;
  const order = activeIds ? afterDealer.filter((p) => activeIds.includes(p.id)) : afterDealer;
  const first = order[0];
  if (!first) throw new Error('Mesa sem jogadores');

  const hands: Record<PlayerId, Card[]> = {};
  const dealt: Record<PlayerId, Card[]> = {};
  for (const player of players) {
    hands[player.id] = [];
    dealt[player.id] = [];
  }
  return {
    dealerSeat,
    prep: null,
    maoSeat: first.seat,
    active: order.map((p) => p.id),
    hands,
    dealt,
    turnedCard: null,
    tricks: [{ plays: [], winner: null }],
    turn: first.id,
    handValue: config.baseHandValue,
    trucoLevel: -1,
    noTruco: false,
    lastRaiseBy: null,
    pendingBet: null,
    envido: { chain: [], resolved: false, points: 0 },
    flor: { declaredBy: [], resolved: false },
    winner: null,
    blind: options.blind ?? false,
    maoDeOnzeTeam: null,
    picaPicaDuel: null,
    passOffer: null,
  };
}

/**
 * Distribui um baralho já preparado (deck[0] é a carta de cima): 3 cartas por jogador,
 * uma de cada vez, começando pelo mão. Nos modos com vira ou muestra, a carta seguinte
 * do baralho é virada na mesa.
 */
export function dealFromDeck(
  config: ModeConfig,
  players: readonly Player[],
  dealerSeat: number,
  deck: readonly Card[],
  options: DealOptions = {},
): HandState {
  const hand = emptyHand(config, players, dealerSeat, options);
  let next = 0;
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (const id of hand.active) {
      const card = deck[next++];
      if (!card) throw new Error('Baralho sem cartas suficientes');
      (hand.hands[id] as Card[]).push(card);
    }
  }
  const needsTurned = config.strength.kind === 'vira' || config.strength.kind === 'muestra';
  hand.turnedCard = needsTurned ? (deck[next] ?? null) : null;
  for (const player of players) hand.dealt[player.id] = [...(hand.hands[player.id] ?? [])];
  return hand;
}

/** Embaralha um baralho novo uma vez e distribui (o jeito de sempre, sem embaralhar e cortar). */
export function dealHand(
  config: ModeConfig,
  players: readonly Player[],
  dealerSeat: number,
  rngState: number,
  options: DealOptions = {},
): DealResult {
  const shuffled = shuffle(createDeck(config.deck), rngState);
  return {
    hand: dealFromDeck(config, players, dealerSeat, shuffled.items, options),
    rngState: shuffled.state,
  };
}

/** Corte: tira "height" cartas de cima e põe embaixo (uma rotação do baralho). */
export function cutDeck<T>(deck: readonly T[], height: number): T[] {
  return [...deck.slice(height), ...deck.slice(0, height)];
}
