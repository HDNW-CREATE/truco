import type { Card, ModeConfig } from '@truco/shared';
import { piezaRankOf } from './strength';

/** Valor da carta no envido: de 1 a 7 vale o número; figuras valem 0. */
export function plainValue(card: Card): number {
  const n = Number(card.rank);
  return Number.isFinite(n) && n <= 7 ? n : 0;
}

function piezaValue(config: ModeConfig, turnedCard: Card | null, card: Card): number | null {
  const pieza = piezaRankOf(config, turnedCard, card);
  if (!pieza) return null;
  return config.envido?.piezaValues?.[pieza] ?? null;
}

interface Split {
  piezas: { card: Card; value: number }[];
  others: Card[];
}

function split(config: ModeConfig, turnedCard: Card | null, cards: readonly Card[]): Split {
  const piezas: Split['piezas'] = [];
  const others: Card[] = [];
  for (const card of cards) {
    const value = piezaValue(config, turnedCard, card);
    if (value === null) others.push(card);
    else piezas.push({ card, value });
  }
  piezas.sort((a, b) => b.value - a.value);
  return { piezas, others };
}

/**
 * Pontos de envido de uma mão: duas cartas do mesmo naipe somam 20 mais os valores.
 * Sem par, vale a maior carta. No Uruguaio, uma pieza vale o valor dela mais a maior das outras.
 */
export function envidoValue(
  config: ModeConfig,
  turnedCard: Card | null,
  cards: readonly Card[],
): number {
  const { piezas, others } = split(config, turnedCard, cards);
  const best = piezas[0];
  if (best) {
    const rest = [...piezas.slice(1).map((p) => p.card), ...others];
    return best.value + Math.max(0, ...rest.map(plainValue));
  }
  let total = Math.max(0, ...cards.map(plainValue));
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      if (a && b && a.suit !== null && a.suit === b.suit) {
        total = Math.max(total, 20 + plainValue(a) + plainValue(b));
      }
    }
  }
  return total;
}

/** Flor: três cartas do mesmo naipe. No Uruguaio as piezas combinam com qualquer naipe. */
export function hasFlor(config: ModeConfig, turnedCard: Card | null, cards: readonly Card[]): boolean {
  if (cards.length !== 3) return false;
  const { piezas, others } = split(config, turnedCard, cards);
  if (piezas.length >= 2) return true;
  const suits = new Set(others.map((c) => c.suit));
  return suits.size === 1 && !suits.has(null);
}

/** Pontos da flor, para comparar duas flores. */
export function florValue(
  config: ModeConfig,
  turnedCard: Card | null,
  cards: readonly Card[],
): number {
  const { piezas, others } = split(config, turnedCard, cards);
  const best = piezas[0];
  if (best) {
    const rest = [...piezas.slice(1).map((p) => p.card), ...others];
    return best.value + rest.reduce((sum, c) => sum + plainValue(c), 0);
  }
  return 20 + cards.reduce((sum, c) => sum + plainValue(c), 0);
}
