import type { Card, CardPattern, ModeConfig, SpanishRank } from '@truco/shared';
import { createDeck } from '../cards/deck';
import { manilhaRank } from './manilha';

export function matchesPattern(card: Card, pattern: CardPattern): boolean {
  return card.rank === pattern.rank && (pattern.suit === undefined || pattern.suit === card.suit);
}

function ladderStrength(ladder: CardPattern[][], card: Card): number {
  const index = ladder.findIndex((step) => step.some((p) => matchesPattern(card, p)));
  return index < 0 ? 0 : ladder.length - index;
}

/**
 * Uruguaio: diz como qual pieza a carta atua (ou null se não for pieza).
 * Se a muestra for uma pieza, o rei (12) do mesmo naipe assume o lugar dela.
 */
export function piezaRankOf(
  config: ModeConfig,
  turnedCard: Card | null,
  card: Card,
): SpanishRank | null {
  if (config.strength.kind !== 'muestra' || !turnedCard || card.suit !== turnedCard.suit) {
    return null;
  }
  const piezas = config.strength.piezaRanks;
  if (piezas.includes(card.rank as SpanishRank)) return card.rank as SpanishRank;
  if (card.rank === '12' && piezas.includes(turnedCard.rank as SpanishRank)) {
    return turnedCard.rank as SpanishRank;
  }
  return null;
}

/** Força da carta na mão atual: quanto maior, mais forte. Valores iguais empatam. */
export function cardStrength(config: ModeConfig, turnedCard: Card | null, card: Card): number {
  const rule = config.strength;
  if (card.rank === 'CORINGA') return 1000;
  if (rule.kind === 'vira') {
    if (card.rank === manilhaRank(config, turnedCard) && card.suit) {
      return 100 + rule.manilhaSuitOrder.indexOf(card.suit);
    }
    return rule.commonOrder.indexOf(card.rank);
  }
  if (rule.kind === 'muestra') {
    const pieza = piezaRankOf(config, turnedCard, card);
    if (pieza) return 100 + (rule.piezaRanks.length - rule.piezaRanks.indexOf(pieza));
  }
  return ladderStrength(rule.ladder, card);
}

/** Força relativa da carta entre todas do baralho, de 0 (pior) a 1 (melhor). Útil para os bots. */
export function cardPower(config: ModeConfig, turnedCard: Card | null, card: Card): number {
  const mine = cardStrength(config, turnedCard, card);
  const deck = createDeck(config.deck);
  const weaker = deck.filter((c) => cardStrength(config, turnedCard, c) < mine).length;
  return weaker / Math.max(1, deck.length - 1);
}
