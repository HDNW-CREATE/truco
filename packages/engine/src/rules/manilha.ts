import type { Card, ModeConfig, Rank } from '@truco/shared';

/**
 * Valor da manilha quando o modo usa vira: a carta logo acima da vira,
 * voltando para a menor depois da maior (vira 3 → manilha 4).
 * Se a vira for o coringa, a manilha é a menor carta da ordem.
 * Retorna null nos modos sem vira.
 */
export function manilhaRank(config: ModeConfig, turnedCard: Card | null): Rank | null {
  if (config.strength.kind !== 'vira' || turnedCard === null) return null;
  const order = config.strength.commonOrder;
  const index = order.indexOf(turnedCard.rank);
  return order[(index + 1) % order.length] ?? null;
}

/** Diz se a carta é manilha na mão atual (só para modos com vira). */
export function isManilha(config: ModeConfig, turnedCard: Card | null, card: Card): boolean {
  const rank = manilhaRank(config, turnedCard);
  return rank !== null && card.rank === rank;
}
