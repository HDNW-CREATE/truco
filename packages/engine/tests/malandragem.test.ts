import { describe, expect, it } from 'vitest';
import type { Action, CheatRequest, GameEvent, GameOptions, GameState } from '@truco/shared';
import {
  applyAction,
  botDenounceChance,
  buildMode,
  cardFromId,
  CHEAT_PENALTY,
  chooseBotAction,
  chooseBotCheat,
  chooseBotPassResponse,
  createDeck,
  createGame,
  createPlayers,
  FALSE_ACCUSATION_PENALTY,
  getLegalActions,
  getPlayerView,
  getSpectatorView,
  replayGame,
  startNextHand,
} from '../src/index';

const paulista = buildMode('paulista');
const players = createPlayers('2x2', [], []);
const cheatsOn: Partial<GameOptions> = { cheats: true, cheatLimit: 3 };

/** Mesa 2x2 com malandragem liberada, p0 sendo o mão e as mãos escolhidas. */
function table(hands: Record<string, string[]>, options: Partial<GameOptions> = cheatsOn, score: [number, number] = [0, 0]): GameState {
  let state = createGame(paulista, players, 1, options);
  for (let seed = 2; state.hand.maoSeat !== 0; seed++) state = createGame(paulista, players, seed, options);
  const dealt = Object.fromEntries(players.map((p) => [p.id, (hands[p.id] ?? []).map(cardFromId)]));
  const turned = cardFromId('4-ouros');
  const used = new Set([...Object.values(hands).flat(), turned.id]);
  return {
    ...state,
    score,
    stock: createDeck(paulista.deck).filter((c) => !used.has(c.id)),
    hand: { ...state.hand, hands: structuredClone(dealt), dealt, turnedCard: turned },
  };
}

const HANDS = {
  p0: ['3-paus', '7-copas', 'A-espadas'],
  p1: ['2-paus', 'K-copas', 'Q-ouros'],
  p2: ['3-copas', 'J-paus', '6-espadas'],
  p3: ['A-copas', '7-paus', '5-copas'],
};

const cheat = (playerId: string, request: CheatRequest): Action => ({ type: 'MALANDRAGEM', playerId, cheat: request });
const denounce = (playerId: string, target: string): Action => ({ type: 'DENUNCIAR', playerId, target });
const ids = (state: GameState, id: string): string[] => (state.hand.hands[id] ?? []).map((c) => c.id);
const gestures = (events: GameEvent[]): string[] =>
  events.filter((e): e is Extract<GameEvent, { type: 'GESTO' }> => e.type === 'GESTO').map((e) => e.playerId);

describe('malandragem desligada', () => {
  it('não há opções, e malandragem e denúncia são recusadas', () => {
    const state = table(HANDS, {});
    expect(getPlayerView(state, 'p0').cheatOptions).toEqual([]);
    expect(getPlayerView(state, 'p0').cheatsLeft).toBeNull();
    expect(() => applyAction(state, cheat('p0', { kind: 'ponto' }))).toThrow(/não permitida/);
    expect(() => applyAction(state, denounce('p1', 'p0'))).toThrow(/não permitida/);
  });
});

describe('malandragens', () => {
  it('ponto a mais: marca um tento, gasta uma malandragem e faz um gesto', () => {
    const state = table(HANDS, cheatsOn, [4, 2]);
    const { state: after, events } = applyAction(state, cheat('p0', { kind: 'ponto' }));
    expect(after.score).toEqual([5, 2]);
    expect(getPlayerView(after, 'p0').cheatsLeft).toBe(2);
    expect(gestures(events)).toEqual(['p0']);
    expect(after.cheats.records.at(-1)).toMatchObject({ by: 'p0', kind: 'ponto', open: true });
    // Não é a vez de ninguém mudar: malandragem não passa a vez.
    expect(after.hand.turn).toBe(state.hand.turn);
  });

  it('ponto a mais nunca fecha a partida', () => {
    const state = table(HANDS, cheatsOn, [11, 0]);
    expect(getPlayerView(state, 'p0').cheatOptions.some((o) => o.kind === 'ponto')).toBe(false);
    expect(() => applyAction(state, cheat('p0', { kind: 'ponto' }))).toThrow(/não permitida/);
  });

  it('cada jogador tem um limite de malandragens por partida', () => {
    let state = table(HANDS, { cheats: true, cheatLimit: 2 });
    state = applyAction(state, cheat('p1', { kind: 'ponto' })).state;
    state = applyAction(state, cheat('p1', { kind: 'espiar', target: 'p0' })).state;
    expect(getPlayerView(state, 'p1').cheatsLeft).toBe(0);
    expect(getPlayerView(state, 'p1').cheatOptions).toEqual([]);
    expect(() => applyAction(state, cheat('p1', { kind: 'ponto' }))).toThrow(/não permitida/);
    // O limite é de cada um: o p0 ainda pode.
    expect(getPlayerView(state, 'p0').cheatsLeft).toBe(2);
  });

  it('pega ladrão certeiro: desfaz e o time que trapaceou perde 2 pontos', () => {
    let state = table(HANDS, cheatsOn, [5, 3]);
    state = applyAction(state, cheat('p0', { kind: 'ponto' })).state;
    expect(state.score).toEqual([6, 3]);
    const caught = applyAction(state, denounce('p1', 'p0'));
    expect(caught.state.score).toEqual([6 - 1 - CHEAT_PENALTY, 3]);
    expect(caught.events).toContainEqual({ type: 'PEGA_LADRAO', by: 'p1', target: 'p0', correct: true, kind: 'ponto', penalty: { team: 0, points: 2 } });
    expect(caught.state.cheats.records.every((r) => !r.open)).toBe(true);
    // A mesma malandragem não pode ser cobrada duas vezes: agora é acusação falsa.
    const again = applyAction(caught.state, denounce('p3', 'p0'));
    expect(again.state.score).toEqual([3, 3 - FALSE_ACCUSATION_PENALTY]);
    expect(again.events[0]).toMatchObject({ type: 'PEGA_LADRAO', correct: false, kind: null, penalty: { team: 1, points: 1 } });
  });

  it('acusação falsa custa 1 ponto para quem acusou, sem ficar negativo', () => {
    const state = table(HANDS, cheatsOn, [0, 0]);
    const result = applyAction(state, denounce('p1', 'p0'));
    expect(result.state.score).toEqual([0, 0]);
    const scored = table(HANDS, cheatsOn, [0, 4]);
    expect(applyAction(scored, denounce('p1', 'p0')).state.score).toEqual([0, 3]);
  });

  it('só adversário denuncia; o parceiro não pode', () => {
    let state = table(HANDS);
    state = applyAction(state, cheat('p0', { kind: 'ponto' })).state;
    expect(() => applyAction(state, denounce('p2', 'p0'))).toThrow(/não permitida/);
  });

  it('depois que a janela fecha, denunciar vira acusação falsa', () => {
    let state = table(HANDS, cheatsOn, [2, 2]);
    state = applyAction(state, cheat('p0', { kind: 'ponto' })).state;
    const id = state.cheats.records.at(-1)?.id as number;
    // Só quem trapaceou fecha (o servidor manda em nome dele) e só se estiver aberta.
    expect(() => applyAction(state, { type: 'FECHAR_MALANDRAGEM', playerId: 'p1', id })).toThrow(/não permitida/);
    state = applyAction(state, { type: 'FECHAR_MALANDRAGEM', playerId: 'p0', id }).state;
    expect(() => applyAction(state, { type: 'FECHAR_MALANDRAGEM', playerId: 'p0', id })).toThrow(/não permitida/);
    const late = applyAction(state, denounce('p1', 'p0'));
    expect(late.state.score).toEqual([3, 1]);
    expect(late.events[0]).toMatchObject({ correct: false });
  });

  it('carta na manga: guarda a carta, puxa outra do monte e a carta fica fora do baralho', () => {
    let state = table(HANDS);
    const top = state.stock[0]?.id as string;
    const result = applyAction(state, cheat('p0', { kind: 'manga', cardId: '3-paus' }));
    state = result.state;
    expect(ids(state, 'p0')).toEqual([top, '7-copas', 'A-espadas']);
    expect(getPlayerView(state, 'p0').mySleeve.map((c) => c.id)).toEqual(['3-paus']);
    expect(getPlayerView(state, 'p1').mySleeve).toEqual([]);
    expect(gestures(result.events)).toEqual(['p0']);

    // Próxima mão: o 3 de paus não está no baralho de ninguém.
    state = applyAction(state, { type: 'CORRER', playerId: 'p0' }).state;
    state = startNextHand(state).state;
    for (const p of players) expect(ids(state, p.id)).not.toContain('3-paus');
    expect(state.hand.turnedCard?.id).not.toBe('3-paus');

    // Usar a manga troca uma carta da mão e não gasta outra malandragem.
    const left = getPlayerView(state, 'p0').cheatsLeft;
    const swap = state.hand.hands.p0?.[1]?.id as string;
    const used = applyAction(state, cheat('p0', { kind: 'usar_manga', cardId: swap })).state;
    expect(ids(used, 'p0')).toContain('3-paus');
    expect(ids(used, 'p0')).not.toContain(swap);
    expect(used.cheats.sleeves.p0).toEqual([]);
    expect(getPlayerView(used, 'p0').cheatsLeft).toBe(left);
    // Também pode ser pega: desfaz a troca.
    const caught = applyAction(used, denounce('p1', 'p0')).state;
    expect(ids(caught, 'p0')).toContain(swap);
    expect(caught.cheats.sleeves.p0?.map((c) => c.id)).toEqual(['3-paus']);
  });

  it('carta na manga pega na mesma mão: a carta volta para a mão e a puxada volta para o monte', () => {
    let state = table(HANDS);
    const top = state.stock[0]?.id as string;
    state = applyAction(state, cheat('p0', { kind: 'manga', cardId: '3-paus' })).state;
    state = applyAction(state, denounce('p3', 'p0')).state;
    expect(ids(state, 'p0')).toEqual(['3-paus', '7-copas', 'A-espadas']);
    expect(state.stock[0]?.id).toBe(top);
    expect(state.cheats.sleeves.p0).toEqual([]);
  });

  it('espiar: só quem espiou vê a carta, só de quem está ao lado, e só naquela atualização', () => {
    const state = table(HANDS);
    // No 2x2 o parceiro fica de frente: não dá para espiar.
    expect(() => applyAction(state, cheat('p0', { kind: 'espiar', target: 'p2' }))).toThrow(/não permitida/);
    const { state: after } = applyAction(state, cheat('p0', { kind: 'espiar', target: 'p1' }));
    const reveals = getPlayerView(after, 'p0').myReveals;
    expect(reveals).toHaveLength(1);
    expect(reveals[0]).toMatchObject({ kind: 'espiar', owner: 'p1' });
    expect(HANDS.p1).toContain(reveals[0]?.card.id);
    for (const p of ['p1', 'p2', 'p3']) expect(getPlayerView(after, p).myReveals).toEqual([]);
    expect(JSON.stringify(getSpectatorView(after))).not.toContain(reveals[0]?.card.id);
    const next = applyAction(after, { type: 'JOGAR_CARTA', playerId: 'p0', cardId: '7-copas' }).state;
    expect(getPlayerView(next, 'p0').myReveals).toEqual([]);
  });

  it('passar carta: o parceiro vê a oferta, aceita dando outra e as cartas trocam', () => {
    let state = table(HANDS);
    state = applyAction(state, cheat('p0', { kind: 'passar', cardId: 'A-espadas', to: 'p2' })).state;
    expect(getPlayerView(state, 'p2').incomingPass).toEqual({ from: 'p0', card: cardFromId('A-espadas') });
    expect(getPlayerView(state, 'p0').outgoingPass).toEqual({ to: 'p2', cardId: 'A-espadas' });
    expect(getPlayerView(state, 'p1').incomingPass).toBeNull();
    // Oferecer ainda não gasta nada e não faz gesto.
    expect(getPlayerView(state, 'p0').cheatsLeft).toBe(3);
    expect(() => applyAction(state, { type: 'RESPONDER_PASSE', playerId: 'p1', cardId: '2-paus' })).toThrow(/não permitida/);
    expect(() => applyAction(state, { type: 'RESPONDER_PASSE', playerId: 'p2', cardId: '2-paus' })).toThrow(/não permitida/);

    const accepted = applyAction(state, { type: 'RESPONDER_PASSE', playerId: 'p2', cardId: '3-copas' });
    expect(ids(accepted.state, 'p0')).toEqual(['3-paus', '7-copas', '3-copas']);
    expect(ids(accepted.state, 'p2')).toEqual(['A-espadas', 'J-paus', '6-espadas']);
    expect(gestures(accepted.events)).toEqual(['p0', 'p2']);
    expect(getPlayerView(accepted.state, 'p0').cheatsLeft).toBe(2);
    expect(accepted.state.hand.passOffer).toBeNull();

    // Pegar qualquer um dos dois desfaz a troca.
    const caught = applyAction(accepted.state, denounce('p1', 'p2')).state;
    expect(ids(caught, 'p0')).toEqual(HANDS.p0);
    expect(ids(caught, 'p2')).toEqual(HANDS.p2);
    expect(caught.score).toEqual([0, 0]);
  });

  it('passar carta recusado: nada muda e não gasta malandragem', () => {
    let state = table(HANDS);
    state = applyAction(state, cheat('p0', { kind: 'passar', cardId: 'A-espadas', to: 'p2' })).state;
    const refused = applyAction(state, { type: 'RESPONDER_PASSE', playerId: 'p2', cardId: null });
    expect(ids(refused.state, 'p0')).toEqual(HANDS.p0);
    expect(refused.events).toEqual([]);
    expect(getPlayerView(refused.state, 'p0').cheatsLeft).toBe(3);
    // No mano a mano não há parceiro.
    const solo = createGame(paulista, createPlayers('1x1', [], []), 3, cheatsOn);
    expect(getPlayerView(solo, 'p0').cheatOptions.some((o) => o.kind === 'passar')).toBe(false);
  });

  it('a visão de ninguém mostra manga, monte, registros ou o que os outros viram', () => {
    let state = table(HANDS);
    state = applyAction(state, cheat('p0', { kind: 'manga', cardId: '3-paus' })).state;
    state = applyAction(state, cheat('p1', { kind: 'espiar', target: 'p0' })).state;
    const texts = [JSON.stringify(getSpectatorView(state)), JSON.stringify(getPlayerView(state, 'p2')), JSON.stringify(getPlayerView(state, 'p3'))];
    for (const text of texts) {
      for (const secret of ['"stock"', '"records"', '"sleeves"', '"reveals"', '3-paus']) expect(text).not.toContain(secret);
    }
  });
});

describe('malandragens do baralho', () => {
  const ritual: Partial<GameOptions> = { ...cheatsOn, shuffleAndCut: true };
  const start = (): GameState => createGame(paulista, players, 21, ritual);

  it('baralho viciado: a carta escolhida vai para o topo e cai na mão do mão', () => {
    let state = start();
    const shuffler = state.hand.prep?.shuffler as string;
    const result = applyAction(state, { type: 'EMBARALHAR', playerId: shuffler, times: 3, stack: { cardId: '3-paus', position: 'topo' } });
    expect(gestures(result.events)).toEqual([shuffler]);
    state = result.state;
    state = applyAction(state, { type: 'CORTAR', playerId: state.hand.prep?.cutter as string, cuts: [] }).state;
    const mao = state.players.find((p) => p.seat === state.hand.maoSeat)?.id as string;
    expect(state.hand.hands[mao]?.[0]?.id).toBe('3-paus');
  });

  it('baralho viciado no fundo e olhar o corte: quem corta vê a carta de baixo', () => {
    let state = start();
    const shuffler = state.hand.prep?.shuffler as string;
    state = applyAction(state, { type: 'EMBARALHAR', playerId: shuffler, times: 2, stack: { cardId: 'K-ouros', position: 'fundo' } }).state;
    const cutter = state.hand.prep?.cutter as string;
    const cut = applyAction(state, { type: 'CORTAR', playerId: cutter, cuts: [], peek: true });
    expect(getPlayerView(cut.state, cutter).myReveals).toEqual([{ to: cutter, kind: 'olhar_corte', card: cardFromId('K-ouros'), owner: null }]);
    expect(getPlayerView(cut.state, shuffler).myReveals).toEqual([]);
    expect(gestures(cut.events)).toEqual([cutter]);
    expect(getPlayerView(cut.state, cutter).cheatsLeft).toBe(2);
  });

  it('olhar o corte mostra a carta que ficou embaixo depois dos cortes', () => {
    let state = start();
    state = applyAction(state, { type: 'EMBARALHAR', playerId: state.hand.prep?.shuffler as string, times: 1 }).state;
    const deck = state.deck ?? [];
    const cutter = state.hand.prep?.cutter as string;
    const cut = applyAction(state, { type: 'CORTAR', playerId: cutter, cuts: [10], peek: true });
    expect(getPlayerView(cut.state, cutter).myReveals[0]?.card).toEqual(deck[9]);
  });

  it('recusa viciar com carta que não existe e malandragens do baralho sem a opção', () => {
    const state = start();
    const shuffler = state.hand.prep?.shuffler as string;
    expect(() => applyAction(state, { type: 'EMBARALHAR', playerId: shuffler, times: 1, stack: { cardId: '9-xis', position: 'topo' } })).toThrow(/não permitida/);
    expect(() =>
      applyAction(state, { type: 'EMBARALHAR', playerId: shuffler, times: 1, stack: { cardId: '3-paus', position: 'meio' as 'topo' } }),
    ).toThrow(/não permitida/);
    const plain = createGame(paulista, players, 21, { shuffleAndCut: true });
    expect(() =>
      applyAction(plain, { type: 'EMBARALHAR', playerId: plain.hand.prep?.shuffler as string, times: 1, stack: { cardId: '3-paus', position: 'topo' } }),
    ).toThrow(/não permitida/);
  });

  it('baralho viciado pego antes de distribuir: o baralho é embaralhado de novo', () => {
    let state = start();
    const shuffler = state.hand.prep?.shuffler as string;
    state = applyAction(state, { type: 'EMBARALHAR', playerId: shuffler, times: 1, stack: { cardId: '3-paus', position: 'topo' } }).state;
    expect(state.deck?.[0]?.id).toBe('3-paus');
    const cutter = state.hand.prep?.cutter as string;
    const caught = applyAction(state, denounce(cutter, shuffler)).state;
    expect(caught.deck?.[0]?.id).not.toBe('3-paus');
    expect(caught.deck).toHaveLength(40);
  });
});

describe('bots malandros', () => {
  it('escolhem malandragens que existem, respondem ao passe e denunciam conforme a personalidade', () => {
    const state = table(HANDS);
    const view = getPlayerView(state, 'p0');
    const choice = chooseBotCheat(view, { level: 'medio', personality: { aggression: 0.5, bluff: 1 }, random: () => 0 });
    expect(choice).not.toBeNull();
    expect(() => applyAction(state, cheat('p0', choice as CheatRequest))).not.toThrow();
    expect(chooseBotCheat(view, { level: 'medio', personality: { aggression: 0.5, bluff: 0 }, random: () => 0.5 })).toBeNull();

    const offered = applyAction(state, cheat('p0', { kind: 'passar', cardId: 'A-espadas', to: 'p2' })).state;
    const answer = chooseBotPassResponse(getPlayerView(offered, 'p2'), () => 0);
    expect(answer).not.toBeNull();
    expect(() => applyAction(offered, { type: 'RESPONDER_PASSE', playerId: 'p2', cardId: answer })).not.toThrow();
    expect(chooseBotPassResponse(getPlayerView(offered, 'p2'), () => 0.99)).toBeNull();

    expect(botDenounceChance({ aggression: 1, bluff: 0 })).toBeGreaterThan(botDenounceChance({ aggression: 0, bluff: 0 }));
  });

  it('humano que deixou o tempo acabar nunca trapaceia pelo bot', () => {
    const state = createGame(paulista, players, 21, { ...cheatsOn, shuffleAndCut: true });
    const view = getPlayerView(state, state.hand.prep?.shuffler as string);
    for (let i = 0; i < 20; i++) {
      const action = chooseBotAction(view, { level: 'medio', personality: { aggression: 1, bluff: 1 } });
      expect(action).not.toHaveProperty('stack');
    }
  });

  it('partida inteira entre bots malandros, com denúncias, termina e se repete pela seed', () => {
    let random = 0.123;
    const next = (): number => (random = (random * 9301 + 0.49297) % 1);
    const options = { ...cheatsOn, shuffleAndCut: true };
    let state = createGame(paulista, players, 77, options);
    const persona = { aggression: 0.6, bluff: 1 };
    let cheats = 0;
    let denounces = 0;
    for (let i = 0; i < 8000 && state.phase !== 'fim_de_partida'; i++) {
      if (state.phase === 'fim_da_mao') {
        state = startNextHand(state).state;
        continue;
      }
      // Fecha janelas antigas, como o servidor faz depois de 5 s.
      const stale = state.cheats.records.find((r) => r.open && next() < 0.3);
      if (stale) {
        state = applyAction(state, { type: 'FECHAR_MALANDRAGEM', playerId: stale.by, id: stale.id }).state;
        continue;
      }
      const actor = state.players.find((p) => getLegalActions(state, p.id).length > 0);
      if (!actor) throw new Error('travou');
      const offer = state.hand.passOffer;
      if (offer) {
        const answer = chooseBotPassResponse(getPlayerView(state, offer.to), next);
        state = applyAction(state, { type: 'RESPONDER_PASSE', playerId: offer.to, cardId: answer }).state;
        continue;
      }
      const view = getPlayerView(state, actor.id);
      const trick = chooseBotCheat(view, { level: 'medio', personality: persona, random: next, cheat: true });
      if (trick) {
        const result = applyAction(state, cheat(actor.id, trick));
        state = result.state;
        cheats++;
        const gesture = result.events.find((e) => e.type === 'GESTO');
        const rival = state.players.find((p) => p.team !== actor.team);
        if (gesture && rival && next() < botDenounceChance(persona)) {
          state = applyAction(state, denounce(rival.id, actor.id)).state;
          denounces++;
        }
        continue;
      }
      state = applyAction(state, chooseBotAction(view, { level: 'medio', personality: persona, random: next, cheat: true })).state;
    }
    expect(state.phase).toBe('fim_de_partida');
    expect(cheats).toBeGreaterThan(0);
    expect(denounces).toBeGreaterThan(0);
    const again = replayGame(paulista, players, 77, state.history, options);
    expect(again.score).toEqual(state.score);
    expect(again.cheats.used).toEqual(state.cheats.used);
  });
});
