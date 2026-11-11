import { describe, expect, it } from 'vitest';
import type { Action, GameState, PlayerView } from '@truco/shared';
import {
  applyAction,
  buildMode,
  chooseBotAction,
  createDeck,
  createGame,
  createGameWithEvents,
  createPlayers,
  cutDeck,
  getLegalActions,
  getPlayerView,
  getSpectatorView,
  MAX_CUTS,
  MAX_SHUFFLES,
  replayGame,
  shuffle,
  startNextHand,
} from '../src/index';

const paulista = buildMode('paulista');
const players = createPlayers('2x2', [], []);
const on = { shuffleAndCut: true } as const;

const shuffleAction = (state: GameState, times: number): Action => ({
  type: 'EMBARALHAR',
  playerId: state.hand.prep?.shuffler ?? '',
  times,
});
const cutAction = (state: GameState, cuts: number[]): Action => ({
  type: 'CORTAR',
  playerId: state.hand.prep?.cutter ?? '',
  cuts,
});

/** Todas as cartas distribuídas na ordem em que saíram do baralho, mais a vira. */
function dealtOrder(state: GameState): string[] {
  const h = state.hand;
  const order: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (const id of h.active) order.push((h.hands[id] ?? [])[round]?.id ?? '?');
  }
  if (h.turnedCard) order.push(h.turnedCard.id);
  return order;
}

describe('embaralhar e cortar', () => {
  it('desligado, a partida começa com as cartas já distribuídas, como sempre', () => {
    const state = createGame(paulista, players, 7);
    expect(state.phase).toBe('jogando');
    expect(state.hand.prep).toBeNull();
    expect(state.deck).toBeNull();
    expect(state.hand.hands.p0).toHaveLength(3);
  });

  it('ligado, o pé recebe o baralho e só ele pode embaralhar', () => {
    const { state, events } = createGameWithEvents(paulista, players, 7, on);
    expect(state.phase).toBe('embaralhando');
    const dealer = state.players.find((p) => p.seat === state.hand.dealerSeat);
    expect(state.hand.prep).toMatchObject({ shuffler: dealer?.id, shuffles: 0, cuts: null, deckSize: 40 });
    expect(events).toEqual([{ type: 'VEZ_DE_EMBARALHAR', playerId: dealer?.id, handNumber: 1 }]);
    expect(Object.values(state.hand.hands).flat()).toHaveLength(0);

    for (const p of state.players) {
      const legal = getLegalActions(state, p.id);
      if (p.id === dealer?.id) {
        expect(legal).toHaveLength(MAX_SHUFFLES);
        expect(legal.every((a) => a.type === 'EMBARALHAR')).toBe(true);
      } else expect(legal).toEqual([]);
    }
  });

  it('quem corta é o adversário à esquerda do pé, ou o mão, conforme a opção da sala', () => {
    const left = createGame(paulista, players, 7, on);
    const dealer = left.hand.dealerSeat;
    expect(left.hand.prep?.cutter).toBe(`p${(dealer + 3) % 4}`);
    const mao = createGame(paulista, players, 7, { shuffleAndCut: true, cutter: 'mao' });
    expect(mao.hand.prep?.cutter).toBe(`p${(dealer + 1) % 4}`);
    // Sempre do time adversário.
    expect(Number(left.hand.prep?.cutter.slice(1)) % 2).not.toBe(dealer % 2);
    expect(Number(mao.hand.prep?.cutter.slice(1)) % 2).not.toBe(dealer % 2);
  });

  it('recusa embaralhar fora dos limites, fora da vez ou duas vezes', () => {
    const state = createGame(paulista, players, 7, on);
    for (const times of [0, MAX_SHUFFLES + 1, 2.5, Number.NaN]) {
      expect(() => applyAction(state, shuffleAction(state, times))).toThrow(/não permitida/);
    }
    const other = state.players.find((p) => p.id !== state.hand.prep?.shuffler) as { id: string };
    expect(() => applyAction(state, { type: 'EMBARALHAR', playerId: other.id, times: 3 })).toThrow(/não permitida/);
    expect(() => applyAction(state, cutAction(state, []))).toThrow(/não permitida/);

    const shuffled = applyAction(state, shuffleAction(state, 3));
    expect(shuffled.state.phase).toBe('cortando');
    expect(shuffled.state.hand.prep?.shuffles).toBe(3);
    expect(shuffled.events).toEqual([{ type: 'BARALHO_EMBARALHADO', playerId: state.hand.prep?.shuffler, times: 3 }]);
    expect(() => applyAction(shuffled.state, shuffleAction(state, 3))).toThrow(/não permitida/);
  });

  it('recusa cortes inválidos: mais de três, altura zero, o baralho inteiro, números quebrados', () => {
    const state = applyAction(createGame(paulista, players, 7, on), shuffleAction(createGame(paulista, players, 7, on), 2)).state;
    const bad = [[1, 2, 3, 4], [0], [40], [-3], [10.5], ['5' as unknown as number]];
    for (const cuts of bad) {
      expect(() => applyAction(state, cutAction(state, cuts))).toThrow(/não permitida/);
    }
    expect(() => applyAction(state, { type: 'CORTAR', playerId: state.hand.prep?.cutter ?? '', cuts: 'x' as unknown as number[] })).toThrow();
    const notCutter = state.players.find((p) => p.id !== state.hand.prep?.cutter) as { id: string };
    expect(() => applyAction(state, { type: 'CORTAR', playerId: notCutter.id, cuts: [5] })).toThrow(/não permitida/);
    expect(MAX_CUTS).toBe(3);
  });

  it('cada embaralhada vem da seed e cada corte é uma rotação do baralho', () => {
    const start = createGame(paulista, players, 99, on);
    // Mesmo cálculo feito à mão: 4 embaralhadas seguidas a partir do estado do gerador.
    let deck = createDeck(paulista.deck);
    let rng = start.rngState;
    for (let i = 0; i < 4; i++) {
      const step = shuffle(deck, rng);
      deck = step.items;
      rng = step.state;
    }
    for (const height of [7, 20, 3]) deck = cutDeck(deck, height);

    const shuffled = applyAction(start, shuffleAction(start, 4)).state;
    const cut = applyAction(shuffled, cutAction(shuffled, [7, 20, 3]));
    expect(cut.state.phase).toBe('jogando');
    expect(cut.state.rngState).toBe(rng);
    expect(dealtOrder(cut.state)).toEqual(deck.slice(0, 13).map((c) => c.id));
    expect(cut.events.map((e) => e.type)).toEqual(['BARALHO_CORTADO', 'CARTAS_DISTRIBUIDAS']);
    expect(cut.state.deck).toBeNull();
    expect(cut.state.hand.prep).toBeNull();
  });

  it('corte simples: as cartas de cima vão para baixo', () => {
    expect(cutDeck([1, 2, 3, 4, 5], 2)).toEqual([3, 4, 5, 1, 2]);
    expect(cutDeck([1, 2, 3, 4, 5], 4)).toEqual([5, 1, 2, 3, 4]);
  });

  it('embaralhar uma vez e bater na mesa dá a mesma mão que o jogo sem a opção', () => {
    const plain = createGame(paulista, players, 31);
    const ritual = createGame(paulista, players, 31, on);
    const shuffled = applyAction(ritual, shuffleAction(ritual, 1)).state;
    const knocked = applyAction(shuffled, cutAction(shuffled, [])).state;
    expect(knocked.hand.hands).toEqual(plain.hand.hands);
    expect(knocked.hand.turnedCard).toEqual(plain.hand.turnedCard);
    expect(knocked.rngState).toBe(plain.rngState);
  });

  it('o pé vê o baralho recolhido aberto antes de embaralhar, e só ele', () => {
    const state = createGame(paulista, players, 5, on);
    const shuffler = state.hand.prep?.shuffler as string;
    const open = getPlayerView(state, shuffler).deckFaceUp;
    expect(open?.map((c) => c.id)).toEqual(createDeck(paulista.deck).map((c) => c.id));
    for (const p of players.filter((p) => p.id !== shuffler)) expect(getPlayerView(state, p.id).deckFaceUp).toBeNull();
    expect(JSON.stringify(getSpectatorView(state))).not.toMatch(/"id":"[^"]*-(ouros|espadas|copas|paus)"/);
    // Depois de embaralhar ninguém mais vê: nem o pé, nem quem corta.
    const cutting = applyAction(state, shuffleAction(state, 3)).state;
    for (const p of players) expect(getPlayerView(cutting, p.id).deckFaceUp).toBeNull();
  });

  it('depois de embaralhar, a visão de ninguém revela a ordem do baralho', () => {
    const state = createGame(paulista, players, 5, on);
    const cutting = applyAction(state, shuffleAction(state, 3)).state;
    const shuffler = state.hand.prep?.shuffler as string;
    for (const s of [state, cutting]) {
      const viewers = s === state ? players.filter((p) => p.id !== shuffler) : players;
      const texts = [JSON.stringify(getSpectatorView(s)), ...viewers.map((p) => JSON.stringify(getPlayerView(s, p.id)))];
      for (const text of texts) {
        expect(text).not.toMatch(/"id":"[^"]*-(ouros|espadas|copas|paus)"/);
        // "deck" só aparece como configuração do modo (tipo de baralho), nunca como lista de cartas.
        expect(text).not.toContain('"deck":[');
      }
      expect(getSpectatorView(s).prep).toEqual(s.hand.prep);
    }
  });

  it('a próxima mão também passa pelo embaralhar e cortar, com o baralho no pé seguinte', () => {
    let state = createGame(paulista, players, 12, on);
    state = applyAction(state, shuffleAction(state, 2)).state;
    state = applyAction(state, cutAction(state, [10])).state;
    const firstDealer = state.hand.dealerSeat;
    const leader = state.hand.turn;
    state = applyAction(state, { type: 'CORRER', playerId: leader }).state;
    expect(state.phase).toBe('fim_da_mao');
    const next = startNextHand(state);
    expect(next.state.phase).toBe('embaralhando');
    expect(next.state.hand.dealerSeat).toBe((firstDealer + 1) % 4);
    expect(next.state.hand.prep?.shuffler).toBe(`p${(firstDealer + 1) % 4}`);
    expect(next.events[0]).toMatchObject({ type: 'VEZ_DE_EMBARALHAR', handNumber: 2 });
  });

  it('com seed e histórico (embaralhadas e cortes incluídos) a partida inteira se repete igual', () => {
    const run = (seed: number, options: { shuffleAndCut: boolean }): GameState => {
      let state = createGame(paulista, players, seed, options);
      let random = 0.37;
      const next = (): number => (random = (random * 9301 + 0.49297) % 1);
      for (let i = 0; i < 4000 && state.phase !== 'fim_de_partida'; i++) {
        if (state.phase === 'fim_da_mao') {
          state = startNextHand(state).state;
          continue;
        }
        const actor = state.players.find((p) => getLegalActions(state, p.id).length > 0);
        if (!actor) throw new Error('travou');
        state = applyAction(state, chooseBotAction(getPlayerView(state, actor.id), { level: 'medio', random: next })).state;
      }
      return state;
    };
    const played = run(2024, on);
    expect(played.phase).toBe('fim_de_partida');
    expect(played.history.some((a) => a.type === 'EMBARALHAR')).toBe(true);
    expect(played.history.some((a) => a.type === 'CORTAR')).toBe(true);
    const again = replayGame(paulista, players, 2024, played.history, on);
    expect(again.score).toEqual(played.score);
    expect(again.history).toEqual(played.history);
    expect(again.rngState).toBe(played.rngState);
    // Sem as opções certas o histórico não encaixa: as embaralhadas não são permitidas.
    expect(() => replayGame(paulista, players, 2024, played.history)).toThrow();
  });

  it('guarda no histórico só os campos da ação', () => {
    const state = createGame(paulista, players, 3, on);
    const extra = { ...shuffleAction(state, 2), deck: ['1-ouros'] } as unknown as Action;
    const after = applyAction(state, extra).state;
    expect(after.history.at(-1)).toEqual({ type: 'EMBARALHAR', playerId: state.hand.prep?.shuffler, times: 2 });
  });

  it('bots embaralham e cortam sozinhos, dentro dos limites', () => {
    let state = createGame(paulista, players, 77, on);
    const view = getPlayerView(state, state.hand.prep?.shuffler ?? '') as PlayerView;
    const shuffleChoice = chooseBotAction(view, { level: 'medio', random: () => 0.99 });
    expect(shuffleChoice).toMatchObject({ type: 'EMBARALHAR' });
    state = applyAction(state, shuffleChoice).state;
    for (const r of [0, 0.5, 0.95]) {
      const cutterView = getPlayerView(state, state.hand.prep?.cutter ?? '');
      const choice = chooseBotAction(cutterView, { level: 'medio', random: () => r });
      expect(choice.type).toBe('CORTAR');
      expect(() => applyAction(state, choice)).not.toThrow();
    }
  });

  it('funciona no pica-pica e com baralho espanhol, e bots jogam partidas inteiras', () => {
    for (const [mode, format] of [['espanhol', '3x3'], ['uruguaio', '2x2'], ['mineiro', '1x1']] as const) {
      const config = buildMode(mode);
      let state = createGame(config, createPlayers(format, [], []), 4, on);
      let cuts = 0;
      for (let i = 0; i < 6000 && state.phase !== 'fim_de_partida'; i++) {
        if (state.phase === 'fim_da_mao') {
          state = startNextHand(state).state;
          continue;
        }
        const actor = state.players.find((p) => getLegalActions(state, p.id).length > 0);
        if (!actor) throw new Error(`travou em ${mode}`);
        const action = chooseBotAction(getPlayerView(state, actor.id), { level: 'medio' });
        if (action.type === 'CORTAR') cuts++;
        state = applyAction(state, action).state;
      }
      expect(state.phase).toBe('fim_de_partida');
      expect(cuts).toBeGreaterThan(0);
    }
  });
});
