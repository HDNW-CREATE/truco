import { describe, expect, it } from 'vitest';
import type { ModeConfig, TableFormat } from '@truco/shared';
import {
  createEspanhol,
  createGame,
  createGauderio,
  createMineiro,
  createPaulista,
  createPlayers,
  createUruguaio,
  dealHand,
  getLegalActions,
  getPlayerView,
  getSpectatorView,
  isManilha,
  manilhaRank,
  playersFromSeat,
} from '../src/index';

const modes: [string, ModeConfig][] = [
  ['paulista', createPaulista()],
  ['paulista sujo com coringa', createPaulista({ sujo: true, coringa: true })],
  ['paulista manilha velha', createPaulista({ manilhaVelha: true })],
  ['mineiro', createMineiro()],
  ['gaudério', createGauderio()],
  ['espanhol', createEspanhol()],
  ['uruguaio', createUruguaio()],
];
const formats: TableFormat[] = ['1x1', '2x2', '3x3'];

describe('distribuição das cartas', () => {
  for (const [name, config] of modes) {
    for (const format of formats) {
      it(`${name} ${format}: 3 cartas para cada um, sem carta repetida`, () => {
        for (let seed = 0; seed < 50; seed++) {
          const state = createGame(config, createPlayers(format), seed);
          const all = state.players.flatMap((p) => state.hand.hands[p.id] ?? []);
          if (state.hand.turnedCard) all.push(state.hand.turnedCard);
          for (const p of state.players) expect(state.hand.hands[p.id]).toHaveLength(3);
          expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
        }
      });
    }
  }

  it('só vira carta na mesa nos modos com vira ou muestra', () => {
    const turned = (config: ModeConfig) =>
      createGame(config, createPlayers('2x2'), 1).hand.turnedCard;
    expect(turned(createPaulista())).not.toBeNull();
    expect(turned(createUruguaio())).not.toBeNull();
    expect(turned(createPaulista({ manilhaVelha: true }))).toBeNull();
    expect(turned(createMineiro())).toBeNull();
    expect(turned(createGauderio())).toBeNull();
    expect(turned(createEspanhol())).toBeNull();
  });

  it('a mesma seed distribui as mesmas cartas e seeds diferentes mudam a mão', () => {
    const deal = (seed: number) =>
      createGame(createPaulista(), createPlayers('2x2'), seed).hand.hands;
    expect(deal(99)).toEqual(deal(99));
    expect(deal(99)).not.toEqual(deal(100));
  });

  it('o mão é quem está depois de quem deu as cartas e joga primeiro', () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(createPaulista(), createPlayers('3x3'), seed);
      expect(state.hand.maoSeat).toBe((state.hand.dealerSeat + 1) % 6);
      expect(state.hand.turn).toBe(`p${state.hand.maoSeat}`);
    }
  });

  it('quem dá as cartas varia conforme a seed', () => {
    const dealers = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      dealers.add(createGame(createPaulista(), createPlayers('2x2'), seed).hand.dealerSeat);
    }
    expect(dealers.size).toBe(4);
  });

  it('a mão começa com o valor base do modo e sem apostas', () => {
    expect(createGame(createPaulista(), createPlayers('2x2'), 1).hand.handValue).toBe(1);
    const mineiro = createGame(createMineiro(), createPlayers('2x2'), 1);
    expect(mineiro.hand.handValue).toBe(2);
    expect(mineiro.hand.pendingBet).toBeNull();
    expect(mineiro.score).toEqual([0, 0]);
    expect(mineiro.phase).toBe('jogando');
  });

  it('ordena os jogadores a partir de um lugar, no sentido do jogo', () => {
    const order = playersFromSeat(createPlayers('2x2'), 2).map((p) => p.seat);
    expect(order).toEqual([2, 3, 0, 1]);
    expect(() => playersFromSeat(createPlayers('2x2'), 9)).toThrow();
  });
});

describe('mesa e jogadores', () => {
  it('alterna os times: parceiro de frente no 2x2, adversário de frente no 3x3', () => {
    const duplas = createPlayers('2x2');
    expect(duplas[0]?.team).toBe(duplas[2]?.team);
    expect(duplas[0]?.team).not.toBe(duplas[1]?.team);
    const trios = createPlayers('3x3');
    expect(trios[0]?.team).not.toBe(trios[3]?.team);
    expect(trios.filter((p) => p.team === 0)).toHaveLength(3);
  });

  it('usa os nomes informados e marca os bots', () => {
    const players = createPlayers('1x1', ['Ana']);
    expect(players.map((p) => p.name)).toEqual(['Ana', 'Jogador 2']);
    expect(players.map((p) => p.isBot)).toEqual([false, true]);
  });

  it('recusa mesa inválida', () => {
    const config = createPaulista();
    const three = createPlayers('2x2').slice(0, 3);
    expect(() => createGame(config, three, 1)).toThrow(/inválido/);

    const sameId = createPlayers('1x1').map((p) => ({ ...p, id: 'x' }));
    expect(() => createGame(config, sameId, 1)).toThrow(/mesmo id/);

    const badSeats = createPlayers('1x1').map((p) => ({ ...p, seat: p.seat + 1 }));
    expect(() => createGame(config, badSeats, 1)).toThrow(/lugares/);

    const sameTeam = createPlayers('1x1').map((p) => ({ ...p, team: 0 as const }));
    expect(() => createGame(config, sameTeam, 1)).toThrow(/times/);
  });
});

describe('vira e manilha', () => {
  const card = (rank: string) => ({ id: `${rank}-copas`, rank, suit: 'copas' }) as never;

  it('a manilha é a carta acima da vira', () => {
    const limpo = createPaulista();
    expect(manilhaRank(limpo, card('4'))).toBe('5');
    expect(manilhaRank(limpo, card('7'))).toBe('Q');
    expect(manilhaRank(limpo, card('K'))).toBe('A');
    expect(manilhaRank(limpo, card('3'))).toBe('4');
  });

  it('no sujo, depois do 7 vem o 8 e depois do 10 vem a dama', () => {
    const sujo = createPaulista({ sujo: true });
    expect(manilhaRank(sujo, card('7'))).toBe('8');
    expect(manilhaRank(sujo, card('10'))).toBe('Q');
  });

  it('vira coringa faz a manilha ser a menor carta', () => {
    const config = createPaulista({ coringa: true });
    expect(manilhaRank(config, { id: 'CORINGA-1', rank: 'CORINGA', suit: null })).toBe('4');
  });

  it('modos sem vira não têm manilha de vira', () => {
    expect(manilhaRank(createMineiro(), card('7'))).toBeNull();
    expect(manilhaRank(createPaulista(), null)).toBeNull();
  });

  it('reconhece a manilha na mão', () => {
    const config = createPaulista();
    expect(isManilha(config, card('7'), card('Q'))).toBe(true);
    expect(isManilha(config, card('7'), card('K'))).toBe(false);
    expect(isManilha(createMineiro(), card('7'), card('Q'))).toBe(false);
  });
});

describe('visão de cada jogador', () => {
  const state = createGame(createPaulista(), createPlayers('2x2'), 5);

  it('cada jogador vê as próprias cartas e só a quantidade das dos outros', () => {
    for (const player of state.players) {
      const view = getPlayerView(state, player.id);
      expect(view.myCards).toEqual(state.hand.hands[player.id]);
      expect(view.cardCounts).toEqual({ p0: 3, p1: 3, p2: 3, p3: 3 });
      expect(view.partnerCards).toBeNull();

      const others = state.players
        .filter((p) => p.id !== player.id)
        .flatMap((p) => state.hand.hands[p.id] ?? [])
        .map((c) => c.id);
      const serialized = JSON.stringify(view);
      const mine = new Set((view.myCards ?? []).map((c) => c.id));
      for (const id of others) {
        if (!mine.has(id) && id !== view.turnedCard?.id) {
          expect(serialized).not.toContain(`"${id}"`);
        }
      }
    }
  });

  it('jogadores diferentes recebem visões diferentes da mesma partida', () => {
    expect(getPlayerView(state, 'p0').myCards).not.toEqual(getPlayerView(state, 'p1').myCards);
  });

  it('o espectador não vê carta da mão de ninguém', () => {
    const view = getSpectatorView(state);
    const serialized = JSON.stringify(view);
    for (const player of state.players) {
      for (const c of state.hand.hands[player.id] ?? []) {
        expect(serialized).not.toContain(`"${c.id}"`);
      }
    }
    expect(view.turnedCard).toEqual(state.hand.turnedCard);
  });

  it('só quem está na vez pode jogar, e pode jogar qualquer carta da mão', () => {
    const turn = state.hand.turn;
    const actions = getLegalActions(state, turn);
    expect(actions.filter((a) => a.type === 'JOGAR_CARTA')).toHaveLength(3);
    expect(actions.some((a) => a.type === 'PEDIR_TRUCO')).toBe(true);
    const other = state.players.find((p) => p.id !== turn);
    expect(getLegalActions(state, other?.id ?? '')).toEqual([]);
    expect(getPlayerView(state, turn).legalActions).toEqual(actions);
  });

  it('na mão de ferro o jogador não vê as próprias cartas', () => {
    const players = createPlayers('2x2');
    const dealt = dealHand(createPaulista(), players, 0, 3, { blind: true });
    const blind = { ...state, hand: dealt.hand };
    const view = getPlayerView(blind, 'p0');
    expect(view.myCards).toBeNull();
    expect(view.cardCounts.p0).toBe(3);
  });

  it('na decisão da mão de onze o time vê as cartas do parceiro, e o adversário não', () => {
    const onze = {
      ...state,
      phase: 'decisao_mao_de_onze' as const,
      hand: { ...state.hand, maoDeOnzeTeam: 0 as const },
    };
    expect(getPlayerView(onze, 'p0').partnerCards).toEqual({ p2: state.hand.hands.p2 });
    expect(getPlayerView(onze, 'p1').partnerCards).toBeNull();
  });

  it('carta coberta aparece sem valor para todos', () => {
    const hidden = state.hand.hands.p1?.[0];
    if (!hidden) throw new Error('sem carta');
    const withTrick = {
      ...state,
      hand: {
        ...state.hand,
        tricks: [{ plays: [{ playerId: 'p1', card: hidden, faceDown: true }], winner: null }],
      },
    };
    expect(getPlayerView(withTrick, 'p0').tricks[0]?.plays[0]).toEqual({
      playerId: 'p1',
      card: null,
      faceDown: true,
    });
  });

  it('recusa jogador que não está na mesa', () => {
    expect(() => getPlayerView(state, 'intruso')).toThrow();
  });
});
