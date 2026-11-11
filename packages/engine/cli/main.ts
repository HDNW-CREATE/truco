// Truco no terminal contra bots.
// Uso: pnpm cli --modo paulista --formato 2x2 --nivel medio [--seed 42] [--sujo] [--coringa]
//      [--manilha-velha] [--sem-flor] [--com-flor] [--cortar] [--auto]
import { createInterface } from 'node:readline/promises';
import type { Action, GameEvent, GameState, ModeId, TableFormat } from '@truco/shared';
import {
  applyAction,
  buildMode,
  cardLabel,
  chooseBotAction,
  createGame,
  createPlayers,
  getLegalActions,
  getPlayerView,
  manilhaRank,
  PERSONAS,
  startNextHand,
  type BotLevel,
} from '../src/index';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const flag = (name: string): boolean => args.includes(`--${name}`);

const modeId = option('modo', 'paulista') as ModeId;
const config = buildMode(modeId, {
  sujo: flag('sujo'),
  coringa: flag('coringa'),
  manilhaVelha: flag('manilha-velha'),
  flor: flag('sem-flor') ? false : flag('com-flor') ? true : undefined,
});
const format = option('formato', '2x2') as TableFormat;
const seed = Number(option('seed', String(Date.now() % 100000)));
const level = option('nivel', 'medio') as BotLevel;
const auto = flag('auto');
const kind = config.deck.kind;

const names = ['Você', ...PERSONAS.map((p) => p.name)];
const players = createPlayers(format, names, auto ? [] : [0]);
const nameOf = (id: string): string => players.find((p) => p.id === id)?.name ?? id;
const rl = createInterface({ input: process.stdin, output: process.stdout });

function describe(action: Action, state: GameState): string {
  switch (action.type) {
    case 'JOGAR_CARTA': {
      const card = state.hand.hands[action.playerId]?.find((c) => c.id === action.cardId);
      const label = card ? cardLabel(card, kind) : action.cardId;
      return action.faceDown ? `Jogar ${label} coberta` : `Jogar ${label}`;
    }
    case 'PEDIR_TRUCO': {
      const pending = state.hand.pendingBet?.kind === 'truco' ? 1 : 0;
      const index = pending
        ? config.trucoLadder.findIndex((s) => s.name === state.hand.pendingBet?.step) + 1
        : state.hand.trucoLevel + 1;
      return `Pedir ${config.trucoLadder[index]?.name}`;
    }
    case 'CANTAR_ENVIDO':
      return `Cantar ${action.step}`;
    case 'CANTAR_FLOR':
      return `Cantar ${action.step.replaceAll('_', ' ')}`;
    case 'RESPONDER':
      return action.accept ? 'Quero' : 'Não quero';
    case 'CORRER':
      return 'Correr';
    case 'DECIDIR_MAO_DE_ONZE':
      return action.play ? 'Jogar a mão de onze' : 'Correr da mão de onze';
    case 'EMBARALHAR':
      return `Embaralhar ${action.times} ${action.times === 1 ? 'vez' : 'vezes'}`;
    case 'CORTAR':
      return action.cuts.length ? `Cortar com ${action.cuts.join(' e ')} cartas` : 'Bater na mesa (não cortar)';
    default:
      return action.type;
  }
}

function report(events: GameEvent[]): void {
  for (const e of events) {
    if (e.type === 'CARTA_JOGADA') {
      const label = e.play.card ? cardLabel(e.play.card, kind) : 'carta coberta';
      console.log(`  ${nameOf(e.play.playerId)} jogou ${label}`);
    } else if (e.type === 'FALA') console.log(`  ${nameOf(e.playerId)}: "${e.text}"`);
    else if (e.type === 'VAZA_ENCERRADA') {
      console.log(e.winner === 'empate' ? '  → Empatou a vaza' : `  → Vaza do time ${e.winner + 1}`);
    } else if (e.type === 'ENVIDO_RESOLVIDO') {
      const values = e.values ? ` (${e.values[0]} a ${e.values[1]})` : '';
      console.log(`  → Envido: time ${e.winner + 1} leva ${e.points}${values}`);
    } else if (e.type === 'FLOR_RESOLVIDA') console.log(`  → Flor: time ${e.winner + 1} leva ${e.points}`);
    else if (e.type === 'BARALHO_EMBARALHADO') console.log(`  ${nameOf(e.playerId)} embaralhou ${e.times}x`);
    else if (e.type === 'BARALHO_CORTADO') {
      console.log(`  ${nameOf(e.playerId)} ${e.cuts.length ? `cortou (${e.cuts.join(', ')})` : 'bateu na mesa'}`);
    } else if (e.type === 'MAO_DE_ONZE') console.log(`  Mão de onze do time ${e.team + 1}`);
    else if (e.type === 'MAO_DE_FERRO') console.log('  Mão de ferro: todos jogam no escuro!');
    else if (e.type === 'PICA_PICA') console.log(`  Pica-pica: ${nameOf(e.duel[0])} x ${nameOf(e.duel[1])}`);
    else if (e.type === 'MAO_ENCERRADA') {
      console.log(e.winner === null ? '  → Ninguém pontuou' : `  → Mão do time ${e.winner + 1} (+${e.points})`);
    }
  }
}

function header(state: GameState): void {
  const view = getPlayerView(state, 'p0');
  if (view.prep) {
    console.log(`
— Mão ${state.handNumber} — ${nameOf(view.prep.shuffler)} embaralha e ${nameOf(view.prep.cutter)} corta —`);
    return;
  }
  console.log(`\n— Mão ${state.handNumber} — Placar: nós ${state.score[0]} x ${state.score[1]} eles —`);
  if (view.turnedCard) {
    const rank = manilhaRank(config, view.turnedCard);
    console.log(`Vira: ${cardLabel(view.turnedCard, kind)}${rank ? ` (manilha: ${rank})` : ''}`);
  }
  if (!auto) {
    const cards = view.myCards?.map((c) => cardLabel(c, kind)).join('   ') ?? '(no escuro)';
    console.log(`Suas cartas: ${cards}`);
  }
}

async function ask(state: GameState, actions: Action[]): Promise<Action> {
  const view = getPlayerView(state, 'p0');
  if (view.myCards) console.log(`\nSuas cartas: ${view.myCards.map((c) => cardLabel(c, kind)).join('   ')}`);
  actions.forEach((a, i) => console.log(`  ${i + 1}) ${describe(a, state)}`));
  for (;;) {
    const answer = await rl.question('Sua jogada: ');
    const chosen = actions[Number(answer) - 1];
    if (chosen) return chosen;
    console.log('Opção inválida.');
  }
}

console.log(`${config.name} (${config.variant}) — ${format} — seed ${seed} — bots: ${level}`);
let state = createGame(config, players, seed, { shuffleAndCut: flag('cortar') });
header(state);

while (state.phase !== 'fim_de_partida') {
  if (state.phase === 'fim_da_mao') {
    const next = startNextHand(state);
    state = next.state;
    header(state);
    report(next.events.filter((e) => e.type !== 'CARTAS_DISTRIBUIDAS'));
    continue;
  }
  const actor = state.players.find((p) => getLegalActions(state, p.id).length > 0);
  if (!actor) throw new Error('Jogo travado');
  const legal = getLegalActions(state, actor.id);
  const action = actor.isBot
    ? chooseBotAction(getPlayerView(state, actor.id), {
        level,
        personality: PERSONAS[(actor.seat + 5) % PERSONAS.length]?.personality,
      })
    : await ask(state, legal);
  const result = applyAction(state, action);
  state = result.state;
  report(result.events);
  // Com embaralhar e cortar, as cartas só chegam depois do corte.
  if (result.events.some((e) => e.type === 'CARTAS_DISTRIBUIDAS')) header(state);
}

console.log(`\nFim de partida! Placar final: ${state.score[0]} x ${state.score[1]}.`);
console.log(state.winner === 0 ? 'Seu time venceu!' : 'O time adversário venceu.');
rl.close();
