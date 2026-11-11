import { describe, expect, it } from 'vitest';
import type { Card, ModeConfig } from '@truco/shared';
import {
  cardLabel,
  createDeck,
  createEspanhol,
  createGauderio,
  createMineiro,
  createPaulista,
  createUruguaio,
  nextInt,
  nextRandom,
  shuffle,
} from '../src/index';

const ids = (cards: Card[]): string[] => cards.map((c) => c.id);

describe('baralho', () => {
  const cases: [string, ModeConfig, number][] = [
    ['paulista limpo', createPaulista(), 40],
    ['paulista sujo', createPaulista({ sujo: true }), 52],
    ['paulista limpo com coringa', createPaulista({ coringa: true }), 41],
    ['mineiro', createMineiro(), 40],
    ['gaudério', createGauderio(), 40],
    ['espanhol', createEspanhol(), 40],
    ['uruguaio', createUruguaio(), 40],
  ];

  it.each(cases)('%s tem o número certo de cartas, sem repetição', (_, config, size) => {
    const deck = createDeck(config.deck);
    expect(deck).toHaveLength(size);
    expect(new Set(ids(deck)).size).toBe(size);
  });

  it('o limpo não tem 8, 9 nem 10 e o sujo tem', () => {
    const limpo = createDeck(createPaulista().deck).map((c) => c.rank);
    const sujo = createDeck(createPaulista({ sujo: true }).deck).map((c) => c.rank);
    for (const rank of ['8', '9', '10']) {
      expect(limpo).not.toContain(rank);
      expect(sujo).toContain(rank);
    }
  });

  it('o baralho espanhol não tem 8, 9 nem figuras francesas', () => {
    const ranks = new Set(createDeck(createGauderio().deck).map((c) => c.rank));
    expect([...ranks].sort()).toEqual(['1', '10', '11', '12', '2', '3', '4', '5', '6', '7']);
  });

  it('o coringa não tem naipe', () => {
    const joker = createDeck(createPaulista({ coringa: true }).deck).find(
      (c) => c.rank === 'CORINGA',
    );
    expect(joker?.suit).toBeNull();
    expect(cardLabel(joker as Card, 'frances')).toBe('Coringa');
  });

  it('mostra a carta em texto', () => {
    expect(cardLabel({ id: '4-paus', rank: '4', suit: 'paus' }, 'frances')).toBe('4♣');
    expect(cardLabel({ id: '1-espadas', rank: '1', suit: 'espadas' }, 'espanhol')).toBe(
      '1 de espadas',
    );
  });
});

describe('embaralhamento com seed', () => {
  const deck = createDeck(createPaulista().deck);

  it('a mesma seed dá a mesma ordem', () => {
    expect(ids(shuffle(deck, 42).items)).toEqual(ids(shuffle(deck, 42).items));
  });

  it('seeds diferentes dão ordens diferentes', () => {
    expect(ids(shuffle(deck, 1).items)).not.toEqual(ids(shuffle(deck, 2).items));
  });

  it('não perde nem duplica cartas e não altera o baralho original', () => {
    const before = ids(deck);
    const result = shuffle(deck, 7);
    expect(ids(deck)).toEqual(before);
    expect(ids(result.items).sort()).toEqual([...before].sort());
    expect(ids(result.items)).not.toEqual(before);
  });

  it('avança o estado do gerador', () => {
    expect(shuffle(deck, 7).state).not.toBe(7);
  });

  it('gera números em [0, 1) e inteiros dentro do limite', () => {
    let state = 123;
    for (let i = 0; i < 1000; i++) {
      const step = nextRandom(state);
      expect(step.value).toBeGreaterThanOrEqual(0);
      expect(step.value).toBeLessThan(1);
      const int = nextInt(state, 6);
      expect(int.value).toBeGreaterThanOrEqual(0);
      expect(int.value).toBeLessThan(6);
      state = step.state;
    }
  });

  it('cada posição recebe cartas variadas ao longo de muitas seeds', () => {
    const firsts = new Set<string>();
    for (let seed = 0; seed < 300; seed++) firsts.add(shuffle(deck, seed).items[0]?.id ?? '');
    expect(firsts.size).toBeGreaterThan(30);
  });
});
