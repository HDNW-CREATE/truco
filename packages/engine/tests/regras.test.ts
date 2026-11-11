import { describe, expect, it } from 'vitest';
import type { TeamId } from '@truco/shared';
import {
  applyAction,
  cardFromId,
  cardStrength,
  createEspanhol,
  createGauderio,
  createMineiro,
  createPaulista,
  createUruguaio,
  createValenciano,
  createDeck,
  envidoValue,
  florValue,
  getLegalActions,
  getPlayerView,
  handResult,
  hasFlor,
  startNextHand,
} from '../src/index';
import { envido, naoQuero, play, quero, run, setup, truco } from './util';

const c = cardFromId;
const E = 'empate' as const;

describe('hierarquia das cartas', () => {
  it('Paulista: ordem comum e manilhas por naipe', () => {
    const config = createPaulista();
    const vira = c('7-copas'); // manilha = Q
    const s = (id: string) => cardStrength(config, vira, c(id));
    const order = ['4-ouros', '5-ouros', '6-ouros', '7-ouros', 'J-ouros', 'K-ouros', 'A-ouros', '2-ouros', '3-ouros', 'Q-ouros', 'Q-espadas', 'Q-copas', 'Q-paus'];
    for (let i = 1; i < order.length; i++) {
      expect(s(order[i] as string)).toBeGreaterThan(s(order[i - 1] as string));
    }
    expect(s('3-ouros')).toBe(s('3-paus'));
  });

  it('Paulista sujo: 8, 9 e 10 ficam entre o 7 e a dama', () => {
    const config = createPaulista({ sujo: true });
    const s = (id: string) => cardStrength(config, c('2-copas'), c(id));
    expect(s('8-ouros')).toBeGreaterThan(s('7-ouros'));
    expect(s('10-ouros')).toBeGreaterThan(s('9-ouros'));
    expect(s('Q-ouros')).toBeGreaterThan(s('10-ouros'));
  });

  it('coringa ganha de tudo, inclusive do zap', () => {
    const config = createPaulista({ coringa: true });
    const vira = c('3-copas'); // manilha = 4
    expect(cardStrength(config, vira, c('CORINGA-1'))).toBeGreaterThan(
      cardStrength(config, vira, c('4-paus')),
    );
  });

  it('Mineiro e manilha velha: zap, copas, espadilha, pica-fumo e depois o 3', () => {
    for (const config of [createMineiro(), createPaulista({ manilhaVelha: true })]) {
      const s = (id: string) => cardStrength(config, null, c(id));
      const order = ['4-ouros', '7-paus', 'Q-ouros', 'J-ouros', 'K-ouros', 'A-ouros', '2-ouros', '3-ouros', '7-ouros', 'A-espadas', '7-copas', '4-paus'];
      for (let i = 1; i < order.length; i++) {
        expect(s(order[i] as string)).toBeGreaterThan(s(order[i - 1] as string));
      }
    }
  });

  it('baralho espanhol: espadão, basto, sete de espadas, sete de ouros', () => {
    const config = createGauderio();
    const s = (id: string) => cardStrength(config, null, c(id));
    const order = ['4-copas', '5-copas', '6-copas', '7-copas', '10-copas', '11-copas', '12-copas', '1-copas', '2-copas', '3-copas', '7-ouros', '7-espadas', '1-paus', '1-espadas'];
    for (let i = 1; i < order.length; i++) {
      expect(s(order[i] as string)).toBeGreaterThan(s(order[i - 1] as string));
    }
    expect(s('7-copas')).toBe(s('7-paus'));
    expect(s('1-copas')).toBe(s('1-ouros'));
  });

  it('Uruguaio: piezas do naipe da muestra ganham do espadão', () => {
    const config = createUruguaio();
    const muestra = c('6-copas');
    const s = (id: string) => cardStrength(config, muestra, c(id));
    const order = ['1-espadas', '10-copas', '11-copas', '5-copas', '4-copas', '2-copas'];
    for (let i = 1; i < order.length; i++) {
      expect(s(order[i] as string)).toBeGreaterThan(s(order[i - 1] as string));
    }
    expect(s('2-ouros')).toBeLessThan(s('1-espadas'));
  });

  it('Uruguaio: se a muestra é pieza, o rei do naipe assume o lugar dela', () => {
    const config = createUruguaio();
    const muestra = c('2-copas');
    const s = (id: string) => cardStrength(config, muestra, c(id));
    expect(s('12-copas')).toBeGreaterThan(s('4-copas'));
    expect(s('12-ouros')).toBeLessThan(s('1-espadas'));
  });

  it('Truc Valenciano: 22 cartas, sem doses, figuras e ases falsos', () => {
    const deck = createDeck(createValenciano().deck);
    expect(deck).toHaveLength(22);
    expect(deck.some((card) => card.id === '1-ouros')).toBe(false);
    expect(deck.some((card) => card.id === '1-espadas')).toBe(true);
  });
});

describe('resultado da mão pelas vazas', () => {
  const r = (w: (TeamId | 'empate')[], rule: 'brasileiro' | 'rioplatense' = 'brasileiro', mao: TeamId = 1) =>
    handResult(w, rule, mao);

  it('duas vazas vencem a mão', () => {
    expect(r([0, 0])).toBe(0);
    expect(r([0, 1, 1])).toBe(1);
    expect(r([0])).toBeNull();
    expect(r([0, 1])).toBeNull();
  });
  it('empate na 1ª: vence quem ganhar a 2ª', () => {
    expect(r([E, 1])).toBe(1);
    expect(r([E])).toBeNull();
  });
  it('empate na 1ª e na 2ª: vence quem ganhar a 3ª', () => {
    expect(r([E, E])).toBeNull();
    expect(r([E, E, 0])).toBe(0);
  });
  it('1ª com vencedor e empate na 2ª ou na 3ª: vence quem fez a 1ª', () => {
    expect(r([1, E])).toBe(1);
    expect(r([0, 1, E])).toBe(0);
  });
  it('três empates: ninguém pontua no brasileiro; o mão vence no rioplatense', () => {
    expect(r([E, E, E])).toBe('ninguem');
    expect(r([E, E, E], 'rioplatense', 1)).toBe(1);
  });
});

describe('vazas no jogo', () => {
  const hands = {
    p0: ['3-ouros', '4-copas', '5-copas'],
    p1: ['2-ouros', '6-copas', '7-copas'],
    p2: ['A-ouros', 'K-copas', 'J-copas'],
    p3: ['3-paus', '4-espadas', '5-espadas'],
  };

  it('a carta mais forte ganha a vaza e quem ganhou abre a próxima', () => {
    const state = setup(createPaulista(), { ...hands, p3: ['K-paus', '4-espadas', '5-espadas'] }, { turned: 'Q-ouros' });
    const { state: after, events } = run(state, [play('p0', '3-ouros'), play('p1', '2-ouros'), play('p2', 'A-ouros'), play('p3', 'K-paus')]);
    expect(after.hand.tricks[0]?.winner).toBe(0);
    expect(after.hand.turn).toBe('p0');
    expect(events.some((e) => e.type === 'VAZA_ENCERRADA' && e.winner === 0)).toBe(true);
  });

  it('cartas iguais de times diferentes empatam e quem abriu abre de novo', () => {
    const state = setup(createPaulista(), hands, { turned: 'Q-ouros' });
    const { state: after } = run(state, [play('p0', '3-ouros'), play('p1', '2-ouros'), play('p2', 'A-ouros'), play('p3', '3-paus')]);
    expect(after.hand.tricks[0]?.winner).toBe('empate');
    expect(after.hand.turn).toBe('p0');
  });

  it('a manilha ganha do 3 e a mão termina em duas vazas', () => {
    const state = setup(createPaulista(), { ...hands, p1: ['4-ouros', '6-copas', '7-copas'] }, { turned: '3-espadas' });
    const first = run(state, [play('p0', '3-ouros'), play('p1', '4-ouros'), play('p2', 'A-ouros'), play('p3', '3-paus')]);
    expect(first.state.hand.tricks[0]?.winner).toBe(1);
    expect(first.state.hand.turn).toBe('p1');
    const second = run(first.state, [play('p1', '7-copas'), play('p2', 'J-copas'), play('p3', '4-espadas'), play('p0', '5-copas')]);
    expect(second.state.phase).toBe('fim_da_mao');
    expect(second.state.score).toEqual([0, 1]);
    expect(second.state.hand.winner).toBe(1);
  });

  it('carta coberta só a partir da 2ª vaza e não vale nada', () => {
    const state = setup(createPaulista(), hands, { turned: 'Q-ouros' });
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'JOGAR_CARTA' && a.faceDown)).toBe(false);
    const first = run(state, [play('p0', '3-ouros'), play('p1', '2-ouros'), play('p2', 'A-ouros'), play('p3', '4-espadas')]);
    const second = run(first.state, [play('p0', '5-copas', true), play('p1', '6-copas'), play('p2', 'K-copas', true), play('p3', '5-espadas')]);
    expect(second.state.hand.tricks[1]?.winner).toBe(1);
    const view = getPlayerView(second.state, 'p1');
    expect(view.tricks[1]?.plays[0]?.card).toBeNull();
    const event = second.events.find((e) => e.type === 'CARTA_JOGADA');
    expect(event && event.type === 'CARTA_JOGADA' && event.play.card).toBeNull();
  });

  it('recusa ação fora da vez ou com carta que o jogador não tem', () => {
    const state = setup(createPaulista(), hands, { turned: 'Q-ouros' });
    expect(() => applyAction(state, play('p1', '2-ouros'))).toThrow(/não permitida/);
    expect(() => applyAction(state, play('p0', '2-ouros'))).toThrow(/não permitida/);
    expect(() => applyAction(state, quero('p0'))).toThrow();
  });

  it('não altera o estado recebido', () => {
    const state = setup(createPaulista(), hands, { turned: 'Q-ouros' });
    const snapshot = JSON.stringify(state);
    applyAction(state, play('p0', '3-ouros'));
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('três empates no Paulista: ninguém pontua', () => {
    const tie = {
      p0: ['3-ouros', '2-ouros', 'A-ouros'],
      p1: ['3-copas', '2-copas', 'A-copas'],
      p2: ['4-ouros', '5-ouros', '6-ouros'],
      p3: ['4-copas', '5-copas', '6-copas'],
    };
    const state = setup(createPaulista(), tie, { turned: '7-paus' });
    const { state: after, events } = run(state, [
      play('p0', '3-ouros'), play('p1', '3-copas'), play('p2', '4-ouros'), play('p3', '4-copas'),
      play('p0', '2-ouros'), play('p1', '2-copas'), play('p2', '5-ouros'), play('p3', '5-copas'),
      play('p0', 'A-ouros'), play('p1', 'A-copas'), play('p2', '6-ouros'), play('p3', '6-copas'),
    ]);
    expect(after.phase).toBe('fim_da_mao');
    expect(after.score).toEqual([0, 0]);
    expect(events.some((e) => e.type === 'MAO_ENCERRADA' && e.winner === null)).toBe(true);
  });
});

describe('truco', () => {
  const hands = {
    p0: ['3-ouros', '4-copas', '5-copas'],
    p1: ['2-ouros', '6-copas', '7-copas'],
    p2: ['A-ouros', 'K-copas', 'J-copas'],
    p3: ['K-paus', '4-espadas', '5-espadas'],
  };
  const paulista = () => setup(createPaulista(), hands, { turned: 'Q-ouros' });

  it('recusar o truco dá 1 ponto a quem pediu', () => {
    const { state } = run(paulista(), [truco('p0'), naoQuero('p1')]);
    expect(state.score).toEqual([1, 0]);
    expect(state.phase).toBe('fim_da_mao');
  });

  it('aceitar faz a mão valer 3, e só o outro time pode pedir seis', () => {
    const { state } = run(paulista(), [truco('p0'), quero('p3')]);
    expect(state.hand.handValue).toBe(3);
    expect(state.phase).toBe('jogando');
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'PEDIR_TRUCO')).toBe(false);
    const next = run(state, [play('p0', '3-ouros')]).state;
    expect(getLegalActions(next, 'p1').some((a) => a.type === 'PEDIR_TRUCO')).toBe(true);
  });

  it('a escada sobe: truco, seis, nove, doze', () => {
    const { state, events } = run(paulista(), [truco('p0'), truco('p1'), truco('p0'), truco('p1')]);
    expect(state.hand.pendingBet?.step).toBe('Doze');
    expect(state.hand.handValue).toBe(9);
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'PEDIR_TRUCO')).toBe(false);
    expect(events.filter((e) => e.type === 'FALA').map((e) => e.type === 'FALA' && e.text)).toEqual(['Truco!', 'Seis!', 'Nove!', 'Doze!']);
    const accepted = run(state, [quero('p2')]).state;
    expect(accepted.hand.handValue).toBe(12);
  });

  it('recusar o seis dá 3 pontos a quem pediu o seis', () => {
    const { state } = run(paulista(), [truco('p0'), truco('p1'), naoQuero('p2')]);
    expect(state.score).toEqual([0, 3]);
  });

  it('só o time desafiado responde', () => {
    const state = run(paulista(), [truco('p0')]).state;
    expect(getLegalActions(state, 'p0')).toEqual([]);
    expect(getLegalActions(state, 'p2')).toEqual([]);
    expect(getLegalActions(state, 'p3').length).toBeGreaterThan(0);
  });

  it('quem ganha a mão trucada leva o valor da aposta', () => {
    const state = run(paulista(), [truco('p0'), quero('p1')]).state;
    const { state: after } = run(state, [
      play('p0', '3-ouros'), play('p1', '2-ouros'), play('p2', 'A-ouros'), play('p3', 'K-paus'),
      play('p0', '4-copas'), play('p1', '6-copas'), play('p2', 'K-copas'), play('p3', '4-espadas'),
    ]);
    expect(after.score).toEqual([3, 0]);
  });

  it('correr dá o valor atual da mão ao adversário', () => {
    const { state } = run(paulista(), [{ type: 'CORRER', playerId: 'p0' }]);
    expect(state.score).toEqual([0, 1]);
  });

  it('Mineiro: a mão vale 2 e o truco vale 4', () => {
    const state = setup(createMineiro(), hands);
    expect(run(state, [truco('p0'), naoQuero('p1')]).state.score).toEqual([2, 0]);
    expect(run(state, [truco('p0'), quero('p1')]).state.hand.handValue).toBe(4);
  });

  it('Gaudério: truco 2, retruco 3, vale quatro 4', () => {
    const state = setup(createGauderio({ flor: false }), {
      p0: ['3-ouros', '4-copas', '5-paus'], p1: ['2-ouros', '6-copas', '7-paus'],
      p2: ['1-ouros', '12-copas', '11-paus'], p3: ['12-paus', '4-espadas', '5-ouros'],
    });
    const { state: after } = run(state, [truco('p0'), truco('p1'), truco('p0'), quero('p1')]);
    expect(after.hand.handValue).toBe(4);
  });

  it('Valenciano: aceitar o Joc Fora faz a mão valer a partida', () => {
    const state = setup(createValenciano(), {
      p0: ['1-espadas', '7-espadas', '3-ouros'], p1: ['4-copas', '5-copas', '6-paus'],
      p2: ['4-ouros', '5-ouros', '6-ouros'], p3: ['4-paus', '5-paus', '6-copas'],
    });
    const { state: after } = run(state, [
      truco('p0'), truco('p1'), truco('p0'), truco('p1'), quero('p0'),
      play('p0', '1-espadas'), play('p1', '4-copas'), play('p2', '4-ouros'), play('p3', '4-paus'),
      play('p0', '7-espadas'), play('p1', '5-copas'), play('p2', '5-ouros'), play('p3', '5-paus'),
    ]);
    expect(after.phase).toBe('fim_de_partida');
    expect(after.winner).toBe(0);
    expect(after.score[0]).toBe(24);
  });
});

describe('mão de onze e mão de ferro', () => {
  const hands = {
    p0: ['3-ouros', '4-copas', '5-copas'], p1: ['2-ouros', '6-copas', '7-copas'],
    p2: ['A-ouros', 'K-copas', 'J-copas'], p3: ['K-paus', '4-espadas', '5-espadas'],
  };
  const lost = (score: [number, number]) => ({
    ...setup(createPaulista(), hands, { score }),
    phase: 'fim_da_mao' as const,
  });

  it('time com 11 vê as cartas do parceiro e decide; jogar vale 3 e ninguém truca', () => {
    const { state, events } = startNextHand(lost([11, 5]));
    expect(state.phase).toBe('decisao_mao_de_onze');
    expect(events.some((e) => e.type === 'MAO_DE_ONZE' && e.team === 0)).toBe(true);
    expect(getPlayerView(state, 'p0').partnerCards).not.toBeNull();
    expect(getPlayerView(state, 'p1').partnerCards).toBeNull();
    expect(getLegalActions(state, 'p1')).toEqual([]);
    const playing = run(state, [{ type: 'DECIDIR_MAO_DE_ONZE', playerId: 'p2', play: true }]).state;
    expect(playing.hand.handValue).toBe(3);
    expect(playing.phase).toBe('jogando');
    expect(getLegalActions(playing, playing.hand.turn).some((a) => a.type === 'PEDIR_TRUCO')).toBe(false);
  });

  it('correr da mão de onze dá 1 ponto ao adversário (2 no Mineiro)', () => {
    const { state } = startNextHand(lost([11, 5]));
    const ran = run(state, [{ type: 'DECIDIR_MAO_DE_ONZE', playerId: 'p0', play: false }]).state;
    expect(ran.score).toEqual([11, 6]);

    const mineiro = startNextHand({ ...setup(createMineiro(), hands, { score: [4, 11] }), phase: 'fim_da_mao' }).state;
    const playing = run(mineiro, [{ type: 'DECIDIR_MAO_DE_ONZE', playerId: 'p1', play: true }]).state;
    expect(playing.hand.handValue).toBe(4);
    const fled = run(mineiro, [{ type: 'DECIDIR_MAO_DE_ONZE', playerId: 'p1', play: false }]).state;
    expect(fled.score).toEqual([6, 11]);
  });

  it('mão de ferro: os dois com 11 jogam no escuro e quem ganha fecha a partida', () => {
    const { state, events } = startNextHand(lost([11, 11]));
    expect(state.hand.blind).toBe(true);
    expect(events.some((e) => e.type === 'MAO_DE_FERRO')).toBe(true);
    let current = state;
    for (let i = 0; i < 12 && current.phase === 'jogando'; i++) {
      const id = current.hand.turn;
      const view = getPlayerView(current, id);
      expect(view.myCards).toBeNull();
      expect(JSON.stringify(view)).not.toContain(current.hand.hands[id]?.[0]?.id ?? 'x');
      const actions = view.legalActions;
      expect(actions.some((a) => a.type === 'PEDIR_TRUCO')).toBe(false);
      const card = actions.find((a) => a.type === 'JOGAR_CARTA');
      expect(card && card.type === 'JOGAR_CARTA' && card.cardId).toMatch(/^oculta-/);
      current = applyAction(current, card as never).state;
    }
    expect(current.phase).toBe('fim_de_partida');
    expect(Math.max(...current.score)).toBe(12);
  });

  it('a próxima mão passa o baralho adiante e só começa depois do fim da mão', () => {
    const state = setup(createPaulista(), hands);
    expect(() => startNextHand(state)).toThrow();
    const next = startNextHand({ ...state, phase: 'fim_da_mao' }).state;
    expect(next.hand.dealerSeat).toBe((state.hand.dealerSeat + 1) % 4);
    expect(next.handNumber).toBe(state.handNumber + 1);
    expect(next.phase).toBe('jogando');
  });
});

describe('envido', () => {
  const config = createEspanhol();
  it('calcula os pontos', () => {
    const v = (ids: string[]) => envidoValue(config, null, ids.map(c));
    expect(v(['7-espadas', '6-espadas', '1-ouros'])).toBe(33);
    expect(v(['12-copas', '11-copas', '4-ouros'])).toBe(20);
    expect(v(['12-copas', '5-copas', '7-ouros'])).toBe(25);
    expect(v(['7-espadas', '5-ouros', '3-copas'])).toBe(7);
    expect(v(['7-espadas', '6-espadas', '5-espadas'])).toBe(33);
  });

  const hands = {
    p0: ['7-espadas', '6-espadas', '1-ouros'], // 33
    p1: ['5-copas', '4-copas', '3-paus'], // 29
    p2: ['12-ouros', '11-paus', '2-copas'], // 2
    p3: ['7-copas', '10-ouros', '6-paus'], // 7
  };
  const start = () => setup(config, hands);

  it('aceito: vence o maior e leva 2', () => {
    const { state, events } = run(start(), [envido('p0'), quero('p1')]);
    expect(state.score).toEqual([2, 0]);
    expect(state.phase).toBe('jogando');
    expect(state.hand.turn).toBe('p0');
    expect(events.find((e) => e.type === 'ENVIDO_RESOLVIDO')).toMatchObject({ winner: 0, values: [33, 29] });
  });
  it('recusado: quem cantou leva 1', () => {
    expect(run(start(), [envido('p0'), naoQuero('p3')]).state.score).toEqual([1, 0]);
  });
  it('envido, envido, real envido aceito vale 7; recusado vale 4', () => {
    const chain = [envido('p0'), envido('p1'), envido('p0', 'Real Envido')];
    expect(run(start(), [...chain, quero('p1')]).state.score).toEqual([7, 0]);
    expect(run(start(), [...chain, naoQuero('p1')]).state.score).toEqual([4, 0]);
  });
  it('não aceita um terceiro envido nem voltar atrás na escada', () => {
    const state = run(start(), [envido('p0'), envido('p1')]).state;
    const steps = getLegalActions(state, 'p0').filter((a) => a.type === 'CANTAR_ENVIDO').map((a) => a.type === 'CANTAR_ENVIDO' && a.step);
    expect(steps).toEqual(['Real Envido', 'Falta Envido']);
    const real = run(start(), [envido('p0', 'Real Envido')]).state;
    expect(getLegalActions(real, 'p1').filter((a) => a.type === 'CANTAR_ENVIDO')).toHaveLength(1);
  });
  it('empate no envido favorece o mão', () => {
    const tied = setup(config, { ...hands, p1: ['7-copas', '6-copas', '3-paus'], p3: ['10-ouros', '5-paus', '4-espadas'] });
    expect(run(tied, [envido('p0'), quero('p1')]).state.score).toEqual([2, 0]);
    const tiedOther = setup(config, { ...hands, p0: ['5-espadas', '4-espadas', '1-ouros'], p1: ['5-copas', '4-copas', '3-paus'] });
    expect(run(tiedOther, [envido('p0'), quero('p1')]).state.score).toEqual([2, 0]);
  });
  it('falta envido nas malas vale a partida', () => {
    const { state } = run(setup(config, hands, { score: [3, 10] }), [envido('p0', 'Falta Envido'), quero('p1')]);
    expect(state.phase).toBe('fim_de_partida');
    expect(state.winner).toBe(0);
  });
  it('falta envido nas buenas vale o que falta para quem está na frente', () => {
    const { state } = run(setup(config, hands, { score: [10, 20] }), [envido('p0', 'Falta Envido'), quero('p1')]);
    expect(state.score).toEqual([20, 20]);
  });
  it('falta envido no Gaudério vale o que falta para o líder', () => {
    const state = setup(createGauderio({ flor: false, pointsToWin: 24 }), hands, { score: [4, 10] });
    expect(run(state, [envido('p0', 'Falta Envido'), quero('p1')]).state.score).toEqual([18, 10]);
  });
  it('falta envido recusado depois de envido vale 2', () => {
    expect(run(start(), [envido('p0'), envido('p1', 'Falta Envido'), naoQuero('p0')]).state.score).toEqual([0, 2]);
  });
  it('só na primeira vaza, antes de jogar, e antes do truco aceito', () => {
    const afterTruco = run(start(), [truco('p0'), quero('p1')]).state;
    expect(getLegalActions(afterTruco, 'p0').some((a) => a.type === 'CANTAR_ENVIDO')).toBe(false);
    const played = run(start(), [play('p0', '1-ouros'), play('p1', '3-paus'), play('p2', '2-copas'), play('p3', '6-paus')]).state;
    expect(getLegalActions(played, played.hand.turn).some((a) => a.type === 'CANTAR_ENVIDO')).toBe(false);
    const once = run(start(), [envido('p0'), quero('p1')]).state;
    expect(getLegalActions(once, 'p0').some((a) => a.type === 'CANTAR_ENVIDO')).toBe(false);
  });
  it('o envido vem primeiro: dá para responder ao truco com envido', () => {
    const { state } = run(start(), [truco('p0'), envido('p1'), quero('p0')]);
    expect(state.score).toEqual([2, 0]);
    expect(state.hand.trucoLevel).toBe(-1);
    expect(state.hand.pendingBet).toBeNull();
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'PEDIR_TRUCO')).toBe(true);
  });
  it('modos brasileiros não têm envido nem flor', () => {
    const state = setup(createPaulista(), { p0: ['3-ouros', '2-ouros', 'A-ouros'], p1: ['4-copas', '5-copas', '6-copas'], p2: ['4-ouros', '5-ouros', '6-ouros'], p3: ['4-paus', '5-paus', '6-paus'] });
    const types = getLegalActions(state, 'p0').map((a) => a.type);
    expect(types).not.toContain('CANTAR_ENVIDO');
    expect(types).not.toContain('CANTAR_FLOR');
  });
});

describe('flor', () => {
  const config = createGauderio({ flor: true });
  const flor = (playerId: string, step: 'flor' | 'contraflor' | 'contraflor_ao_resto' = 'flor') =>
    ({ type: 'CANTAR_FLOR', playerId, step }) as const;
  const hands = {
    p0: ['7-espadas', '6-espadas', '5-espadas'], // flor 38
    p1: ['5-copas', '4-copas', '3-paus'],
    p2: ['12-ouros', '11-paus', '2-copas'],
    p3: ['7-copas', '10-ouros', '6-paus'],
  };
  const both = { ...hands, p1: ['5-copas', '4-copas', '3-copas'] }; // flor 32

  it('reconhece e pontua a flor', () => {
    expect(hasFlor(config, null, hands.p0.map(c))).toBe(true);
    expect(hasFlor(config, null, hands.p1.map(c))).toBe(false);
    expect(florValue(config, null, hands.p0.map(c))).toBe(38);
  });
  it('flor sem resposta vale 3 e anula o envido', () => {
    const { state } = run(setup(config, hands), [flor('p0')]);
    expect(state.score).toEqual([3, 0]);
    expect(state.phase).toBe('jogando');
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'CANTAR_ENVIDO')).toBe(false);
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'CANTAR_FLOR')).toBe(false);
  });
  it('flor contra flor: a maior leva 6', () => {
    const state = run(setup(config, both), [flor('p0')]).state;
    expect(state.hand.pendingBet?.eligible).toEqual(['p1']);
    expect(getLegalActions(state, 'p3')).toEqual([]);
    expect(run(state, [flor('p1')]).state.score).toEqual([6, 0]);
  });
  it('"com flor me achico": quem cantou leva 4', () => {
    expect(run(setup(config, both), [flor('p0'), naoQuero('p1')]).state.score).toEqual([4, 0]);
  });
  it('contraflor aceita vale 6; recusada vale 4 para quem cantou a contraflor', () => {
    const state = run(setup(config, both), [flor('p0'), flor('p1', 'contraflor')]).state;
    expect(run(state, [quero('p0')]).state.score).toEqual([6, 0]);
    expect(run(state, [naoQuero('p2')]).state.score).toEqual([0, 4]);
  });
  it('contraflor ao resto aceita vale o que falta', () => {
    const state = setup(config, both, { score: [10, 20] });
    const { state: after } = run(state, [flor('p0'), flor('p1', 'contraflor_ao_resto'), quero('p0')]);
    expect(after.score).toEqual([20, 20]);
  });
  it('sem flor na sala, ninguém canta flor', () => {
    const state = setup(createGauderio({ flor: false }), hands);
    expect(getLegalActions(state, 'p0').some((a) => a.type === 'CANTAR_FLOR')).toBe(false);
  });
  it('Uruguaio: flor é obrigatória e as piezas valem mais no envido', () => {
    const uru = createUruguaio();
    const state = setup(uru, hands, { turned: '1-ouros' });
    expect(getLegalActions(state, 'p0')).toEqual([flor('p0')]);
    const muestra = c('6-copas');
    expect(envidoValue(uru, muestra, ['2-copas', '7-ouros', '1-paus'].map(c))).toBe(37);
    expect(envidoValue(uru, muestra, ['4-copas', '5-copas', '1-paus'].map(c))).toBe(34);
    expect(hasFlor(uru, muestra, ['2-copas', '4-copas', '1-paus'].map(c))).toBe(true);
    expect(hasFlor(uru, muestra, ['2-copas', '7-ouros', '1-ouros'].map(c))).toBe(true);
    expect(hasFlor(uru, muestra, ['2-copas', '7-ouros', '1-paus'].map(c))).toBe(false);
    expect(florValue(uru, muestra, ['2-copas', '7-ouros', '1-ouros'].map(c))).toBe(38);
  });
});
