import type {
  Action,
  BetStep,
  Card,
  GameEvent,
  GameOptions,
  GameState,
  ModeConfig,
  Player,
  PlayerId,
  TableFormat,
  TeamId,
  Trick,
} from '@truco/shared';
import { cutDeck, dealFromDeck, emptyHand } from './cards/deal';
import { createDeck } from './cards/deck';
import { nextInt, shuffle } from './cards/rng';
import { PLAYERS_PER_FORMAT } from './players';
import {
  applyCheatAction,
  canPeekCut,
  canStackDeck,
  cleanCheatAction,
  DEFAULT_CHEAT_LIMIT,
  isCheatAction,
  isCheatLegal,
  recordCheat,
} from './rules/cheats';
import { envidoValue, florValue, hasFlor } from './rules/envido';
import { handResult, resolveTrick } from './rules/tricks';

/** Valor interno de uma aposta que vale a partida inteira (ex.: Joc Fora). */
const WHOLE_GAME = 999;

/** Limites do embaralhar e cortar. */
export const MAX_SHUFFLES = 10;
export const MAX_CUTS = 3;

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  shuffleAndCut: false,
  cutter: 'esquerda',
  cheats: false,
  cheatLimit: DEFAULT_CHEAT_LIMIT,
};

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

// ---------- Utilidades ----------

function formatOf(players: readonly Player[]): TableFormat {
  const entry = (Object.entries(PLAYERS_PER_FORMAT) as [TableFormat, number][]).find(
    ([, count]) => count === players.length,
  );
  if (!entry) throw new Error(`Número de jogadores inválido: ${players.length} (use 2, 4 ou 6)`);
  return entry[0];
}

function validatePlayers(players: readonly Player[]): void {
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new Error('Há jogadores com o mesmo id');
  const seats = [...players].map((p) => p.seat).sort((a, b) => a - b);
  if (seats.some((seat, i) => seat !== i)) throw new Error('Os lugares devem ir de 0 a N-1');
  for (const p of players) {
    if (p.team !== p.seat % 2) throw new Error('Os times devem se alternar pelos lugares');
  }
}

export function teamOf(state: GameState, playerId: PlayerId): TeamId {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Jogador ${playerId} não está na mesa`);
  return player.team;
}

const otherTeam = (team: TeamId): TeamId => (team === 0 ? 1 : 0);

function currentTrick(state: GameState): Trick {
  const trick = state.hand.tricks[state.hand.tricks.length - 1];
  if (!trick) throw new Error('Mão sem vaza aberta');
  return trick;
}

function stepValue(step: BetStep): number {
  return step.value === 'partida' ? WHOLE_GAME : step.value;
}

function playedInFirstTrick(state: GameState, playerId: PlayerId): boolean {
  return state.hand.tricks[0]?.plays.some((p) => p.playerId === playerId) ?? false;
}

/** Quanto vale a "falta" para o time que vencer. */
function faltaPoints(state: GameState, winner: TeamId): number {
  const target = state.config.pointsToWin;
  const [a, b] = state.score;
  if (state.config.envido?.malasBuenas && a < target / 2 && b < target / 2) {
    return target - state.score[winner];
  }
  return target - Math.max(a, b);
}

// ---------- Criação e distribuição ----------

/** Quem corta: sempre um adversário do pé (os times se alternam pelos lugares). */
function cutterSeat(state: GameState, dealerSeat: number): number {
  const n = state.players.length;
  return state.options.cutter === 'mao' ? (dealerSeat + 1) % n : (dealerSeat - 1 + n) % n;
}

/**
 * Começa uma mão nova: decide o pica-pica e, com embaralhar e cortar ligado, entrega o baralho
 * ao pé e espera as ações dele e de quem corta. Desligado, embaralha uma vez e distribui direto.
 */
function beginHand(state: GameState, dealerSeat: number, events: GameEvent[]): void {
  const { config } = state;
  let duel: [PlayerId, PlayerId] | null = null;

  const picaPica = config.special.picaPica;
  if (picaPica && state.format === '3x3') {
    const max = Math.max(...state.score);
    if (
      state.picaPicaQueue.length === 0 &&
      state.redondoPlayed &&
      max >= picaPica.from &&
      max < picaPica.to
    ) {
      // Três duelos: cada jogador contra o rival sentado de frente.
      const n = state.players.length;
      for (let i = 1; i <= n / 2; i++) {
        const a = state.players[(dealerSeat + i) % n];
        const b = state.players[(dealerSeat + i + n / 2) % n];
        if (a && b) state.picaPicaQueue.push([a.id, b.id]);
      }
      state.redondoPlayed = false;
    }
    duel = state.picaPicaQueue.shift() ?? null;
    if (!duel) state.redondoPlayed = true;
  }

  state.hand = emptyHand(config, state.players, dealerSeat, { active: duel ?? undefined });
  state.hand.picaPicaDuel = duel;
  state.handNumber += 1;
  // Cartas guardadas na manga ficam fora do baralho.
  const sleeved = new Set(Object.values(state.cheats.sleeves).flat().map((c) => c.id));
  state.deck = createDeck(config.deck).filter((c) => !sleeved.has(c.id));

  if (!state.options.shuffleAndCut) {
    shuffleDeck(state, 1);
    finishDeal(state, events);
    return;
  }
  const shuffler = state.players.find((p) => p.seat === dealerSeat) as Player;
  const cutter = state.players.find((p) => p.seat === cutterSeat(state, dealerSeat)) as Player;
  state.hand.prep = {
    shuffler: shuffler.id,
    cutter: cutter.id,
    shuffles: 0,
    cuts: null,
    deckSize: state.deck.length,
  };
  state.hand.turn = shuffler.id;
  state.phase = 'embaralhando';
  events.push({ type: 'VEZ_DE_EMBARALHAR', playerId: shuffler.id, handNumber: state.handNumber });
}

/** Cada embaralhada é um Fisher-Yates tirado da seed, então a partida continua reproduzível. */
function shuffleDeck(state: GameState, times: number): void {
  let deck = state.deck ?? [];
  for (let i = 0; i < times; i++) {
    const step = shuffle(deck, state.rngState);
    deck = step.items;
    state.rngState = step.state;
  }
  state.deck = deck;
}

/** Distribui o baralho preparado e aplica pica-pica, mão de onze e mão de ferro. */
function finishDeal(state: GameState, events: GameEvent[]): void {
  const { config } = state;
  const previous = state.hand;
  const duel = previous.picaPicaDuel;
  state.hand = dealFromDeck(config, state.players, previous.dealerSeat, state.deck ?? [], {
    active: duel ?? undefined,
  });
  state.hand.picaPicaDuel = duel;
  const used = state.hand.active.length * 3 + (state.hand.turnedCard ? 1 : 0);
  state.stock = (state.deck ?? []).slice(used);
  state.deck = null;
  state.phase = 'jogando';
  events.push({ type: 'CARTAS_DISTRIBUIDAS', handNumber: state.handNumber });
  if (duel) events.push({ type: 'PICA_PICA', duel });

  if (config.special.maoDeOnze) {
    const near = [0, 1].map((t) => state.score[t as TeamId] === config.pointsToWin - 1);
    if (near[0] && near[1] && config.special.maoDeFerro) {
      state.hand.blind = true;
      state.hand.noTruco = true;
      events.push({ type: 'MAO_DE_FERRO' });
    } else if (near[0] || near[1]) {
      const team: TeamId = near[0] ? 0 : 1;
      state.hand.maoDeOnzeTeam = team;
      state.hand.noTruco = true;
      state.phase = 'decisao_mao_de_onze';
      events.push({ type: 'MAO_DE_ONZE', team });
    }
  }
}

/**
 * Cria a partida: sorteia quem dá as cartas, embaralha e distribui a primeira mão.
 * A mesma seed sempre produz a mesma partida.
 */
export function createGame(
  config: ModeConfig,
  players: Player[],
  seed: number,
  options: Partial<GameOptions> = {},
): GameState {
  return createGameWithEvents(config, players, seed, options).state;
}

/** Igual a createGame, devolvendo também os eventos da primeira mão (distribuição ou vez de embaralhar). */
export function createGameWithEvents(
  config: ModeConfig,
  players: Player[],
  seed: number,
  options: Partial<GameOptions> = {},
): ActionResult {
  const format = formatOf(players);
  validatePlayers(players);
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const dealer = nextInt(seed | 0, players.length);
  const state: GameState = {
    config,
    format,
    players: sorted,
    seed,
    options: { ...DEFAULT_GAME_OPTIONS, ...options },
    rngState: dealer.state,
    deck: null,
    stock: [],
    cheats: { records: [], used: {}, sleeves: {}, nextId: 1 },
    reveals: [],
    score: [0, 0],
    handNumber: 0,
    picaPicaQueue: [],
    redondoPlayed: false,
    hand: emptyHand(config, sorted, dealer.value),
    phase: 'jogando',
    winner: null,
    history: [],
  };
  const events: GameEvent[] = [];
  beginHand(state, dealer.value, events);
  return { state, events };
}

/** Depois que uma mão termina, passa o baralho adiante e começa a próxima. */
export function startNextHand(input: GameState): ActionResult {
  if (input.phase !== 'fim_da_mao') throw new Error('A mão atual ainda não terminou');
  const state = structuredClone(input) as GameState;
  const events: GameEvent[] = [];
  state.reveals = [];
  beginHand(state, (state.hand.dealerSeat + 1) % state.players.length, events);
  return { state, events };
}

/**
 * Refaz uma partida a partir da seed, das opções e do histórico de ações
 * (inclusive embaralhadas e cortes). Serve para rever e auditar partidas.
 */
export function replayGame(
  config: ModeConfig,
  players: Player[],
  seed: number,
  history: readonly Action[],
  options: Partial<GameOptions> = {},
): GameState {
  let state = createGame(config, players, seed, options);
  for (const action of history) {
    if (state.phase === 'fim_da_mao') state = startNextHand(state).state;
    state = applyAction(state, action).state;
  }
  return state;
}

// ---------- Ações permitidas ----------

function envidoOptions(state: GameState): string[] {
  const envido = state.config.envido;
  if (!envido) return [];
  const chain = state.hand.envido.chain;
  const names = [...envido.steps.map((s) => s.name), envido.faltaName];
  const last = chain.length ? names.indexOf(chain[chain.length - 1] as string) : -1;
  return names.filter((name, index) => {
    if (index < last) return false;
    const max = envido.steps[index]?.maxRepeat ?? 1;
    return chain.filter((c) => c === name).length < max;
  });
}

function canCallEnvido(state: GameState, playerId: PlayerId): boolean {
  const h = state.hand;
  return (
    state.config.envido !== undefined &&
    h.tricks.length === 1 &&
    !h.envido.resolved &&
    h.trucoLevel === -1 &&
    !h.blind &&
    h.flor.declaredBy.length === 0 &&
    !playedInFirstTrick(state, playerId)
  );
}

function canDeclareFlor(state: GameState, playerId: PlayerId): boolean {
  const h = state.hand;
  return (
    state.config.flor !== undefined &&
    h.tricks.length === 1 &&
    !h.blind &&
    !h.flor.resolved &&
    !(h.envido.resolved && h.envido.chain.length > 0) &&
    !h.flor.declaredBy.includes(playerId) &&
    !playedInFirstTrick(state, playerId) &&
    hasFlor(state.config, h.turnedCard, h.dealt[playerId] ?? [])
  );
}

function pendingTrucoLevel(state: GameState): number {
  const pending = state.hand.pendingBet;
  return pending?.kind === 'truco'
    ? state.config.trucoLadder.findIndex((s) => s.name === pending.step)
    : -1;
}

/** Ações que o jogador pode fazer agora. Lista vazia quando não é a vez dele. */
export function getLegalActions(state: GameState, playerId: PlayerId): Action[] {
  const h = state.hand;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];

  // Embaralhar e cortar vêm antes de tudo e podem caber a quem está fora de um duelo de pica-pica.
  if (state.phase === 'embaralhando') {
    if (h.prep?.shuffler !== playerId) return [];
    return Array.from({ length: MAX_SHUFFLES }, (_, i) => ({ type: 'EMBARALHAR', playerId, times: i + 1 }));
  }
  if (state.phase === 'cortando') {
    if (h.prep?.cutter !== playerId) return [];
    // Exemplos: bater na mesa e um corte no meio. Qualquer corte válido é aceito (ver isLegal).
    return [
      { type: 'CORTAR', playerId, cuts: [] },
      { type: 'CORTAR', playerId, cuts: [Math.floor(h.prep.deckSize / 2)] },
    ];
  }

  if (!h.active.includes(playerId)) return [];
  if (state.phase === 'fim_da_mao' || state.phase === 'fim_de_partida') return [];

  if (state.phase === 'decisao_mao_de_onze') {
    if (player.team !== h.maoDeOnzeTeam) return [];
    return [
      { type: 'DECIDIR_MAO_DE_ONZE', playerId, play: true },
      { type: 'DECIDIR_MAO_DE_ONZE', playerId, play: false },
    ];
  }

  const pending = h.pendingBet;
  if (pending) {
    if (player.team !== pending.awaiting) return [];
    const yes: Action = { type: 'RESPONDER', playerId, accept: true };
    const no: Action = { type: 'RESPONDER', playerId, accept: false };

    if (pending.kind === 'truco') {
      const actions: Action[] = [yes, no];
      if (pendingTrucoLevel(state) + 1 < state.config.trucoLadder.length) {
        actions.push({ type: 'PEDIR_TRUCO', playerId });
      }
      // "O envido vem primeiro": dá para responder ao truco com envido na primeira vaza.
      if (pendingTrucoLevel(state) === 0 && canCallEnvido(state, playerId)) {
        for (const step of envidoOptions(state)) {
          actions.push({ type: 'CANTAR_ENVIDO', playerId, step });
        }
      }
      return actions;
    }

    if (pending.kind === 'envido') {
      const actions: Action[] = [yes, no];
      for (const step of envidoOptions(state)) {
        actions.push({ type: 'CANTAR_ENVIDO', playerId, step });
      }
      return actions;
    }

    // Flor
    if (pending.step === 'flor') {
      if (!pending.eligible?.includes(playerId)) return [];
      const actions: Action[] = [{ type: 'CANTAR_FLOR', playerId, step: 'flor' }, no];
      if (state.config.flor?.contraflor) {
        actions.push({ type: 'CANTAR_FLOR', playerId, step: 'contraflor' });
        actions.push({ type: 'CANTAR_FLOR', playerId, step: 'contraflor_ao_resto' });
      }
      return actions;
    }
    return [yes, no];
  }

  if (h.turn !== playerId) return [];

  const actions: Action[] = [];
  if (canDeclareFlor(state, playerId)) {
    const flor: Action = { type: 'CANTAR_FLOR', playerId, step: 'flor' };
    if (state.config.flor?.mandatory) return [flor];
    actions.push(flor);
  }

  const canCover = state.config.special.cartaCoberta && h.tricks.length >= 2;
  for (const card of h.hands[playerId] ?? []) {
    actions.push({ type: 'JOGAR_CARTA', playerId, cardId: card.id });
    if (canCover) actions.push({ type: 'JOGAR_CARTA', playerId, cardId: card.id, faceDown: true });
  }

  if (
    !h.noTruco &&
    h.lastRaiseBy !== player.team &&
    h.trucoLevel + 1 < state.config.trucoLadder.length
  ) {
    actions.push({ type: 'PEDIR_TRUCO', playerId });
  }
  if (canCallEnvido(state, playerId)) {
    for (const step of envidoOptions(state)) {
      actions.push({ type: 'CANTAR_ENVIDO', playerId, step });
    }
  }
  actions.push({ type: 'CORRER', playerId });
  return actions;
}

// ---------- Aplicação das ações ----------

function actionKey(a: Action): string {
  switch (a.type) {
    case 'JOGAR_CARTA':
      return `${a.type}|${a.playerId}|${a.cardId}|${a.faceDown ? 1 : 0}`;
    case 'CANTAR_ENVIDO':
    case 'CANTAR_FLOR':
      return `${a.type}|${a.playerId}|${a.step}`;
    case 'RESPONDER':
      return `${a.type}|${a.playerId}|${a.accept}`;
    case 'DECIDIR_MAO_DE_ONZE':
      return `${a.type}|${a.playerId}|${a.play}`;
    case 'EMBARALHAR':
      return `${a.type}|${a.playerId}|${a.times}`;
    case 'CORTAR':
      return `${a.type}|${a.playerId}|${Array.isArray(a.cuts) ? a.cuts.join(',') : '?'}`;
    default:
      return `${a.type}|${a.playerId}`;
  }
}

/**
 * Confere se a ação é permitida. Embaralhar e cortar são conferidos pelos valores
 * (o corte pode ser em qualquer altura); o resto precisa estar na lista de ações permitidas.
 */
function isLegal(state: GameState, action: Action): boolean {
  const prep = state.hand.prep;
  if (isCheatAction(action)) return isCheatLegal(state, action);
  if (action.type === 'EMBARALHAR') {
    return (
      state.phase === 'embaralhando' &&
      prep?.shuffler === action.playerId &&
      Number.isInteger(action.times) &&
      action.times >= 1 &&
      action.times <= MAX_SHUFFLES &&
      (action.stack === undefined || canStackDeck(state, action.playerId, action.stack?.cardId, action.stack?.position))
    );
  }
  if (action.type === 'CORTAR') {
    return (
      state.phase === 'cortando' &&
      prep?.cutter === action.playerId &&
      Array.isArray(action.cuts) &&
      action.cuts.length <= MAX_CUTS &&
      action.cuts.every((c) => Number.isInteger(c) && c >= 1 && c < prep.deckSize) &&
      (!action.peek || canPeekCut(state, action.playerId))
    );
  }
  const key = actionKey(action);
  return getLegalActions(state, action.playerId).some((a) => actionKey(a) === key);
}

/** Guarda no histórico só os campos que importam (o cliente pode mandar campos a mais). */
function cleanAction(action: Action): Action {
  if (isCheatAction(action)) return cleanCheatAction(action);
  if (action.type === 'EMBARALHAR') {
    const stack = action.stack ? { cardId: action.stack.cardId, position: action.stack.position } : undefined;
    return { type: action.type, playerId: action.playerId, times: action.times, ...(stack ? { stack } : {}) };
  }
  if (action.type === 'CORTAR') {
    const cuts = Array.isArray(action.cuts) ? [...action.cuts] : action.cuts;
    return { type: action.type, playerId: action.playerId, cuts, ...(action.peek ? { peek: true } : {}) };
  }
  return action;
}

/** Na mão de ferro o cliente só conhece a posição da carta ("oculta-0"); aqui vira o id real. */
function resolveHiddenCard(state: GameState, action: Action): Action {
  if (action.type !== 'JOGAR_CARTA' || !action.cardId.startsWith('oculta-')) return action;
  const index = Number(action.cardId.slice('oculta-'.length));
  const card = state.hand.hands[action.playerId]?.[index];
  if (!card) throw new Error('Carta inexistente');
  return { ...action, cardId: card.id };
}

/** Soma pontos ao time, sem passar do limite da partida, e encerra a partida se fechou. */
function addPoints(state: GameState, team: TeamId, points: number, events: GameEvent[]): void {
  const target = state.config.pointsToWin;
  state.score[team] = Math.min(target, state.score[team] + points);
  if (state.score[team] >= target && state.phase !== 'fim_de_partida') {
    state.phase = 'fim_de_partida';
    state.winner = team;
    state.hand.pendingBet = null;
    events.push({ type: 'PARTIDA_ENCERRADA', winner: team });
  }
}

function endHand(state: GameState, winner: TeamId | null, events: GameEvent[]): void {
  const h = state.hand;
  const points = winner === null ? 0 : Math.min(h.handValue, state.config.pointsToWin);
  h.pendingBet = null;
  h.winner = winner;
  events.push({ type: 'MAO_ENCERRADA', winner, points });
  if (winner !== null) addPoints(state, winner, points, events);
  if (state.phase !== 'fim_de_partida') state.phase = 'fim_da_mao';
}

function say(
  events: GameEvent[],
  playerId: PlayerId,
  text: string,
  kind: Extract<GameEvent, { type: 'FALA' }>['kind'],
): void {
  events.push({ type: 'FALA', playerId, text, kind });
}

function playCard(
  state: GameState,
  action: Extract<Action, { type: 'JOGAR_CARTA' }>,
  events: GameEvent[],
): void {
  const h = state.hand;
  const cards = h.hands[action.playerId] ?? [];
  const index = cards.findIndex((c) => c.id === action.cardId);
  const [card] = cards.splice(index, 1);
  if (!card) throw new Error('Carta inexistente');

  const faceDown = action.faceDown ?? false;
  const trick = currentTrick(state);
  trick.plays.push({ playerId: action.playerId, card, faceDown });
  events.push({
    type: 'CARTA_JOGADA',
    play: { playerId: action.playerId, card: faceDown ? null : card, faceDown },
  });

  if (trick.plays.length < h.active.length) {
    const at = h.active.indexOf(action.playerId);
    h.turn = h.active[(at + 1) % h.active.length] as PlayerId;
    return;
  }

  const outcome = resolveTrick(state.config, h.turnedCard, state.players, trick);
  trick.winner = outcome.winner;
  events.push({ type: 'VAZA_ENCERRADA', winner: outcome.winner, index: h.tricks.length - 1 });

  const mao = state.players.find((p) => p.seat === h.maoSeat);
  const result = handResult(
    h.tricks.map((t) => t.winner as TeamId | 'empate'),
    state.config.tieRule,
    mao?.team ?? 0,
  );
  if (result !== null) {
    endHand(state, result === 'ninguem' ? null : result, events);
    return;
  }
  h.tricks.push({ plays: [], winner: null });
  h.turn = outcome.leader;
}

function callTruco(state: GameState, playerId: PlayerId, events: GameEvent[]): void {
  const h = state.hand;
  const team = teamOf(state, playerId);
  const ladder = state.config.trucoLadder;
  let level = h.trucoLevel + 1;

  // Aumentar em resposta a um pedido é aceitar o pedido anterior e subir mais um degrau.
  const pendingLevel = pendingTrucoLevel(state);
  if (h.pendingBet?.kind === 'truco' && pendingLevel >= 0) {
    h.trucoLevel = pendingLevel;
    h.handValue = stepValue(ladder[pendingLevel] as BetStep);
    h.lastRaiseBy = otherTeam(team);
    level = pendingLevel + 1;
  }
  const step = ladder[level] as BetStep;
  h.pendingBet = { kind: 'truco', step: step.name, by: playerId, awaiting: otherTeam(team) };
  state.phase = 'aguardando_resposta';
  say(events, playerId, `${step.name}!`, 'truco');
  events.push({ type: 'APOSTA_CANTADA', bet: h.pendingBet });
}

function bestOfTeam(
  state: GameState,
  team: TeamId,
  value: (playerId: PlayerId) => number | null,
): number {
  let best = -1;
  for (const id of state.hand.active) {
    if (teamOf(state, id) !== team) continue;
    const v = value(id);
    if (v !== null) best = Math.max(best, v);
  }
  return best;
}

function maoTeam(state: GameState): TeamId {
  return state.players.find((p) => p.seat === state.hand.maoSeat)?.team ?? 0;
}

function callEnvido(
  state: GameState,
  action: Extract<Action, { type: 'CANTAR_ENVIDO' }>,
  events: GameEvent[],
): void {
  const h = state.hand;
  const team = teamOf(state, action.playerId);
  h.envido.chain.push(action.step);
  h.pendingBet = { kind: 'envido', step: action.step, by: action.playerId, awaiting: otherTeam(team) };
  state.phase = 'aguardando_resposta';
  say(events, action.playerId, `${action.step}!`, 'envido');
  events.push({ type: 'APOSTA_CANTADA', bet: h.pendingBet });
}

function chainSum(state: GameState, chain: readonly string[]): number {
  const steps = state.config.envido?.steps ?? [];
  return chain.reduce((sum, name) => sum + Number(steps.find((s) => s.name === name)?.value ?? 0), 0);
}

function answerEnvido(state: GameState, accept: boolean, events: GameEvent[]): void {
  const h = state.hand;
  const pending = h.pendingBet;
  const envido = state.config.envido;
  if (!pending || !envido) return;
  const caller = teamOf(state, pending.by);
  h.envido.resolved = true;
  h.pendingBet = null;
  state.phase = 'jogando';

  if (!accept) {
    const points = Math.max(1, chainSum(state, h.envido.chain.slice(0, -1)));
    h.envido.points = points;
    events.push({ type: 'ENVIDO_RESOLVIDO', winner: caller, points, values: null });
    addPoints(state, caller, points, events);
    return;
  }

  const values = ([0, 1] as const).map((team) =>
    bestOfTeam(state, team, (id) => envidoValue(state.config, h.turnedCard, h.dealt[id] ?? [])),
  ) as [number, number];
  const winner: TeamId =
    values[0] === values[1] ? maoTeam(state) : values[0] > values[1] ? 0 : 1;
  const points = h.envido.chain.includes(envido.faltaName)
    ? faltaPoints(state, winner)
    : chainSum(state, h.envido.chain);
  h.envido.points = points;
  events.push({ type: 'ENVIDO_RESOLVIDO', winner, points, values });
  addPoints(state, winner, points, events);
}

function florWinner(state: GameState): TeamId {
  const h = state.hand;
  const values = ([0, 1] as const).map((team) =>
    bestOfTeam(state, team, (id) => {
      const cards = h.dealt[id] ?? [];
      return hasFlor(state.config, h.turnedCard, cards)
        ? florValue(state.config, h.turnedCard, cards)
        : null;
    }),
  );
  if (values[0] === values[1]) return maoTeam(state);
  return (values[0] as number) > (values[1] as number) ? 0 : 1;
}

function settleFlor(state: GameState, winner: TeamId, points: number, events: GameEvent[]): void {
  const h = state.hand;
  h.flor.resolved = true;
  h.pendingBet = null;
  state.phase = 'jogando';
  events.push({ type: 'FLOR_RESOLVIDA', winner, points });
  addPoints(state, winner, points, events);
}

function callFlor(
  state: GameState,
  action: Extract<Action, { type: 'CANTAR_FLOR' }>,
  events: GameEvent[],
): void {
  const h = state.hand;
  const flor = state.config.flor;
  if (!flor) return;
  const team = teamOf(state, action.playerId);
  const pending = h.pendingBet;
  const labels = { flor: 'Flor!', contraflor: 'Contraflor!', contraflor_ao_resto: 'Contraflor ao resto!' };
  say(events, action.playerId, labels[action.step], 'flor');

  if (pending?.kind === 'flor') {
    // Resposta de quem também tem flor.
    h.flor.declaredBy.push(action.playerId);
    if (action.step === 'flor') {
      settleFlor(state, florWinner(state), flor.value * 2, events);
      return;
    }
    h.pendingBet = { kind: 'flor', step: action.step, by: action.playerId, awaiting: otherTeam(team) };
    events.push({ type: 'APOSTA_CANTADA', bet: h.pendingBet });
    return;
  }

  // Primeira flor da mão: anula o envido.
  h.flor.declaredBy.push(action.playerId);
  h.envido.resolved = true;
  const rivals = h.active.filter(
    (id) =>
      teamOf(state, id) !== team &&
      !playedInFirstTrick(state, id) &&
      !h.flor.declaredBy.includes(id) &&
      hasFlor(state.config, h.turnedCard, h.dealt[id] ?? []),
  );
  if (rivals.length === 0) {
    events.push({ type: 'FLOR_RESOLVIDA', winner: team, points: flor.value });
    addPoints(state, team, flor.value, events);
    return;
  }
  h.pendingBet = {
    kind: 'flor',
    step: 'flor',
    by: action.playerId,
    awaiting: otherTeam(team),
    eligible: rivals,
  };
  state.phase = 'aguardando_resposta';
  events.push({ type: 'APOSTA_CANTADA', bet: h.pendingBet });
}

function answerFlor(state: GameState, accept: boolean, events: GameEvent[]): void {
  const pending = state.hand.pendingBet;
  const flor = state.config.flor;
  if (!pending || !flor) return;
  const caller = teamOf(state, pending.by);
  if (!accept) {
    // "Com flor me achico": quem cantou leva um ponto a mais.
    settleFlor(state, caller, flor.contraflor ? flor.value + 1 : flor.value, events);
    return;
  }
  const winner = florWinner(state);
  const points =
    pending.step === 'contraflor_ao_resto' ? faltaPoints(state, winner) : flor.value * 2;
  settleFlor(state, winner, points, events);
}

function answer(
  state: GameState,
  action: Extract<Action, { type: 'RESPONDER' }>,
  events: GameEvent[],
): void {
  const h = state.hand;
  const pending = h.pendingBet;
  if (!pending) return;
  say(events, action.playerId, action.accept ? 'Quero!' : 'Não quero!', action.accept ? 'aceite' : 'recusa');
  events.push({ type: 'APOSTA_RESPONDIDA', accepted: action.accept, kind: pending.kind });

  if (pending.kind === 'envido') return answerEnvido(state, action.accept, events);
  if (pending.kind === 'flor') return answerFlor(state, action.accept, events);

  const caller = teamOf(state, pending.by);
  if (!action.accept) {
    endHand(state, caller, events);
    return;
  }
  const level = pendingTrucoLevel(state);
  h.trucoLevel = level;
  h.handValue = stepValue(state.config.trucoLadder[level] as BetStep);
  h.lastRaiseBy = caller;
  h.pendingBet = null;
  state.phase = 'jogando';
}

function decideMaoDeOnze(
  state: GameState,
  action: Extract<Action, { type: 'DECIDIR_MAO_DE_ONZE' }>,
  events: GameEvent[],
): void {
  const team = teamOf(state, action.playerId);
  if (action.play) {
    state.hand.handValue = stepValue(state.config.trucoLadder[0] as BetStep);
    state.phase = 'jogando';
    say(events, action.playerId, 'Vamos jogar!', 'onze');
    return;
  }
  say(events, action.playerId, 'Corremos.', 'corre');
  endHand(state, otherTeam(team), events);
}

/**
 * Aplica uma ação e devolve o novo estado e os eventos gerados.
 * Não altera o estado recebido. Lança erro se a ação não for permitida.
 */
export function applyAction(input: GameState, rawAction: Action): ActionResult {
  const action = cleanAction(resolveHiddenCard(input, rawAction));
  if (!isLegal(input, action)) {
    throw new Error(`Ação não permitida: ${actionKey(action)}`);
  }

  const state = structuredClone(input) as GameState;
  const events: GameEvent[] = [];
  state.history.push(action);
  // O que alguém viu escondido vale só para a ação em que viu.
  state.reveals = [];

  if (isCheatAction(action)) {
    applyCheatAction(state, action, events);
    return { state, events };
  }

  switch (action.type) {
    case 'EMBARALHAR': {
      shuffleDeck(state, action.times);
      const stack = action.stack;
      if (stack && state.deck) {
        const deck = state.deck;
        const card = deck.splice(deck.findIndex((c) => c.id === stack.cardId), 1)[0] as Card;
        if (stack.position === 'topo') deck.unshift(card);
        else deck.push(card);
        recordCheat(state, action.playerId, [action.playerId], 'viciado', { kind: 'viciado' }, events);
      }
      const prep = state.hand.prep as NonNullable<typeof state.hand.prep>;
      prep.shuffles = action.times;
      state.hand.turn = prep.cutter;
      state.phase = 'cortando';
      events.push({ type: 'BARALHO_EMBARALHADO', playerId: action.playerId, times: action.times });
      break;
    }
    case 'CORTAR': {
      let deck = state.deck ?? [];
      for (const height of action.cuts) deck = cutDeck(deck, height);
      state.deck = deck;
      const prep = state.hand.prep as NonNullable<typeof state.hand.prep>;
      prep.cuts = [...action.cuts];
      if (action.peek) {
        state.reveals.push({ to: action.playerId, kind: 'olhar_corte', card: deck[deck.length - 1] as Card, owner: null });
        recordCheat(state, action.playerId, [action.playerId], 'olhar_corte', { kind: 'olhar_corte' }, events);
      }
      events.push({ type: 'BARALHO_CORTADO', playerId: action.playerId, cuts: [...action.cuts] });
      finishDeal(state, events);
      break;
    }
    case 'JOGAR_CARTA':
      playCard(state, action, events);
      break;
    case 'PEDIR_TRUCO':
      callTruco(state, action.playerId, events);
      break;
    case 'CANTAR_ENVIDO':
      callEnvido(state, action, events);
      break;
    case 'CANTAR_FLOR':
      callFlor(state, action, events);
      break;
    case 'RESPONDER':
      answer(state, action, events);
      break;
    case 'CORRER':
      say(events, action.playerId, 'Corro!', 'corre');
      endHand(state, otherTeam(teamOf(state, action.playerId)), events);
      break;
    case 'DECIDIR_MAO_DE_ONZE':
      decideMaoDeOnze(state, action, events);
      break;
  }
  return { state, events };
}
