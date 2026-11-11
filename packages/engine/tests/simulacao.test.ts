import { describe, expect, it } from 'vitest';
import type { GameState, ModeConfig, TableFormat } from '@truco/shared';
import {
  applyAction,
  buildMode,
  chooseBotAction,
  createDeck,
  createEspanhol,
  createGame,
  createPlayers,
  estimateWinChance,
  getLegalActions,
  getPlayerView,
  MODE_IDS,
  nextRandom,
  PERSONAS,
  startNextHand,
  type BotLevel,
} from '../src/index';

/** Gerador com seed para as decisões dos bots, para a simulação ser reproduzível. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    const step = nextRandom(state);
    state = step.state;
    return step.value;
  };
}

interface Outcome {
  state: GameState;
  events: string[];
}

function playGame(config: ModeConfig, format: TableFormat, seed: number, levels: BotLevel[]): Outcome {
  const players = createPlayers(format);
  const random = seeded(seed + 1000);
  const deckSize = createDeck(config.deck).length;
  let state = createGame(config, players, seed);
  const seen: string[] = [];

  for (let step = 0; step < 20000 && state.phase !== 'fim_de_partida'; step++) {
    if (state.phase === 'fim_da_mao') {
      const next = startNextHand(state);
      state = next.state;
      seen.push(...next.events.map((e) => e.type));
      // Nenhuma carta repetida na mão recém-distribuída.
      const cards = Object.values(state.hand.hands).flat();
      if (state.hand.turnedCard) cards.push(state.hand.turnedCard);
      expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
      expect(cards.length).toBeLessThanOrEqual(deckSize);
      continue;
    }
    const actor = state.players.find((p) => getLegalActions(state, p.id).length > 0);
    if (!actor) throw new Error(`Jogo travado na fase ${state.phase}`);
    const persona = PERSONAS[actor.seat % PERSONAS.length];
    const action = chooseBotAction(getPlayerView(state, actor.id), {
      level: levels[actor.seat % levels.length] as BotLevel,
      personality: persona?.personality,
      random,
    });
    const result = applyAction(state, action);
    state = result.state;
    seen.push(...result.events.map((e) => e.type));
    expect(state.score[0]).toBeLessThanOrEqual(config.pointsToWin);
    expect(state.score[1]).toBeLessThanOrEqual(config.pointsToWin);
  }
  return { state, events: seen };
}

describe('partidas completas entre bots', () => {
  const formats: TableFormat[] = ['1x1', '2x2', '3x3'];
  const variants: [string, ModeConfig][] = [
    ...MODE_IDS.map((id): [string, ModeConfig] => [id, buildMode(id)]),
    ['paulista sujo com coringa', buildMode('paulista', { sujo: true, coringa: true })],
    ['paulista manilha velha', buildMode('paulista', { manilhaVelha: true })],
    ['gauderio sem flor a 24', buildMode('gauderio', { flor: false, pointsToWin: 24 })],
    ['espanhol com flor', buildMode('espanhol', { flor: true })],
  ];

  for (const [name, config] of variants) {
    for (const format of formats) {
      it(`${name} ${format} termina com um vencedor`, () => {
        for (let seed = 1; seed <= 4; seed++) {
          const { state } = playGame(config, format, seed, ['medio', 'facil']);
          expect(state.phase).toBe('fim_de_partida');
          expect(state.winner).not.toBeNull();
          expect(state.score[state.winner as 0 | 1]).toBe(config.pointsToWin);
        }
      });
    }
  }

  it('a mesma seed reproduz a mesma partida', () => {
    const a = playGame(buildMode('paulista'), '2x2', 7, ['medio']);
    const b = playGame(buildMode('paulista'), '2x2', 7, ['medio']);
    expect(a.state.history).toEqual(b.state.history);
    expect(a.state.score).toEqual(b.state.score);
  });

  it('bots difíceis jogam uma partida inteira', () => {
    const { state } = playGame(buildMode('paulista'), '2x2', 3, ['dificil', 'medio']);
    expect(state.phase).toBe('fim_de_partida');
    const gaucho = playGame(buildMode('gauderio'), '1x1', 3, ['dificil']);
    expect(gaucho.state.phase).toBe('fim_de_partida');
  });

  it('o bot médio ganha do fácil na maioria das partidas', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      // Lugares pares (time 0) são médios; ímpares são fáceis.
      if (playGame(buildMode('paulista'), '2x2', seed, ['medio', 'facil']).state.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThan(18);
  });

  it('o pica-pica acontece no Espanhol 3x3 e alterna com a mão redonda', () => {
    const config = createEspanhol();
    const { events, state } = playGame(config, '3x3', 5, ['medio']);
    expect(state.phase).toBe('fim_de_partida');
    expect(events.filter((e) => e === 'PICA_PICA').length).toBeGreaterThanOrEqual(3);
  });

  it('no duelo do pica-pica só os dois rivais de frente recebem cartas', () => {
    const players = createPlayers('3x3');
    const base = createGame(createEspanhol(), players, 2);
    const ready: GameState = { ...base, score: [6, 3], redondoPlayed: true, phase: 'fim_da_mao' };
    const { state } = startNextHand(ready);
    const duel = state.hand.picaPicaDuel;
    expect(duel).not.toBeNull();
    expect(state.hand.active).toHaveLength(2);
    const [a, b] = state.hand.active.map((id) => players.find((p) => p.id === id));
    expect(Math.abs((a?.seat ?? 0) - (b?.seat ?? 0))).toBe(3);
    expect(a?.team).not.toBe(b?.team);
    for (const p of players) {
      expect(state.hand.hands[p.id]).toHaveLength(state.hand.active.includes(p.id) ? 3 : 0);
    }
    expect(state.picaPicaQueue).toHaveLength(2);
    // Fora da faixa de pontos não há pica-pica.
    const early = startNextHand({ ...ready, score: [2, 1] }).state;
    expect(early.hand.picaPicaDuel).toBeNull();
    expect(early.hand.active).toHaveLength(6);
  });

  it('a estimativa do bot difícil reconhece uma mão forte e uma fraca', () => {
    const players = createPlayers('1x1');
    const config = buildMode('mineiro');
    let strong = 0;
    let weak = 0;
    for (let seed = 1; seed < 400 && (strong === 0 || weak === 0); seed++) {
      const state = createGame(config, players, seed);
      const id = state.hand.turn;
      const ids = (state.hand.hands[id] ?? []).map((c) => c.id);
      const chance = estimateWinChance(getPlayerView(state, id), seeded(seed), undefined, 60);
      if (ids.includes('4-paus') && ids.includes('7-copas')) {
        expect(chance).toBeGreaterThan(0.8);
        strong++;
      }
      if (ids.every((c) => ['4-ouros', '4-copas', '4-espadas', '5-ouros', '5-copas', '5-paus', '5-espadas', '6-ouros', '6-copas', '6-paus', '6-espadas'].includes(c))) {
        expect(chance).toBeLessThan(0.3);
        weak++;
      }
    }
    expect(strong + weak).toBeGreaterThan(0);
  });
});
