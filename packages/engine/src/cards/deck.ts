import type { Card, DeckKind, FrenchRank, ModeConfig, Rank, SpanishRank, Suit } from '@truco/shared';

export const SUITS: readonly Suit[] = ['ouros', 'espadas', 'copas', 'paus'];

export const FRENCH_RANKS: readonly FrenchRank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];

/** O baralho espanhol de truco já vem sem 8 e 9. */
export const SPANISH_RANKS: readonly SpanishRank[] = [
  '1', '2', '3', '4', '5', '6', '7', '10', '11', '12',
];

/** Valores de cada tipo de baralho. */
export function ranksOf(kind: DeckKind): readonly Rank[] {
  return kind === 'frances' ? FRENCH_RANKS : SPANISH_RANKS;
}

export function createCard(rank: Rank, suit: Suit): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

/** Recria a carta a partir do id ("4-paus", "CORINGA-1"). */
export function cardFromId(id: string): Card {
  const [rank, suit] = id.split('-');
  if (rank === 'CORINGA') return { id, rank: 'CORINGA', suit: null };
  return { id, rank: rank as Rank, suit: suit as Suit };
}

/** Monta o baralho do modo, em ordem fixa (ainda sem embaralhar). */
export function createDeck(deck: ModeConfig['deck']): Card[] {
  const removed = new Set<Rank>(deck.removedRanks);
  const removedCards = deck.removedCards ?? [];
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranksOf(deck.kind)) {
      if (removed.has(rank)) continue;
      if (removedCards.some((p) => p.rank === rank && (p.suit === undefined || p.suit === suit))) {
        continue;
      }
      cards.push(createCard(rank, suit));
    }
  }
  for (let i = 1; i <= deck.jokers; i++) {
    cards.push({ id: `CORINGA-${i}`, rank: 'CORINGA', suit: null });
  }
  return cards;
}

const SUIT_SYMBOL: Record<Suit, string> = { ouros: '♦', espadas: '♠', copas: '♥', paus: '♣' };

/** Texto curto para terminal e logs: "4♣" no francês, "1 de espadas" no espanhol. */
export function cardLabel(card: Card, kind: DeckKind): string {
  if (card.suit === null) return 'Coringa';
  return kind === 'frances'
    ? `${card.rank}${SUIT_SYMBOL[card.suit]}`
    : `${card.rank} de ${card.suit}`;
}
