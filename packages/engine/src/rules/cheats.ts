// Malandragens: trapaças de brincadeira, só com a opção "Malandragem liberada".
// Toda malandragem gera um gesto visível e fica aberta para denúncia ("Pega ladrão!")
// até o servidor fechar a janela. O servidor é quem decide tudo; o cliente só pede.
import type {
  Action,
  Card,
  CheatKind,
  CheatRecord,
  CheatRequest,
  CheatUndo,
  GameEvent,
  GamePhase,
  GameState,
  GestureKind,
  HandState,
  PlayerId,
  TeamId,
} from '@truco/shared';
import { nextInt, shuffle } from '../cards/rng';

/** Janela para gritar "Pega ladrão!" depois do gesto. */
export const CHEAT_WINDOW_MS = 5000;
/** Pontos que o time perde quando é pego trapaceando. */
export const CHEAT_PENALTY = 2;
/** Pontos que perde quem acusa sem ter havido trapaça. */
export const FALSE_ACCUSATION_PENALTY = 1;
export const DEFAULT_CHEAT_LIMIT = 3;

export const GESTURES: readonly GestureKind[] = ['nariz', 'chapeu', 'tosse', 'espreguicar', 'olhar_lado'];

/** Fases em que dá para trapacear durante a mão. */
const DURING_HAND = new Set<GamePhase>(['jogando', 'aguardando_resposta', 'decisao_mao_de_onze']);

type CheatAction = Extract<Action, { type: 'MALANDRAGEM' | 'RESPONDER_PASSE' | 'DENUNCIAR' | 'FECHAR_MALANDRAGEM' }>;

export function isCheatAction(action: Action): action is CheatAction {
  return (
    action.type === 'MALANDRAGEM' ||
    action.type === 'RESPONDER_PASSE' ||
    action.type === 'DENUNCIAR' ||
    action.type === 'FECHAR_MALANDRAGEM'
  );
}

function teamOf(state: GameState, id: PlayerId): TeamId | null {
  return state.players.find((p) => p.id === id)?.team ?? null;
}

/** Quantas malandragens o jogador ainda pode fazer (null = malandragem desligada). */
export function cheatsLeft(state: GameState, id: PlayerId): number | null {
  if (!state.options.cheats) return null;
  return Math.max(0, state.options.cheatLimit - (state.cheats.used[id] ?? 0));
}

const hasCharge = (state: GameState, id: PlayerId): boolean => (cheatsLeft(state, id) ?? 0) > 0;

/** Quem está sentado logo ao lado (à esquerda e à direita). */
export function neighborsOf(state: GameState, id: PlayerId): PlayerId[] {
  const n = state.players.length;
  const me = state.players.find((p) => p.id === id);
  if (!me) return [];
  const seats = new Set([(me.seat + 1) % n, (me.seat - 1 + n) % n]);
  seats.delete(me.seat);
  return state.players.filter((p) => seats.has(p.seat)).map((p) => p.id);
}

function partnersOf(state: GameState, id: PlayerId): PlayerId[] {
  const team = teamOf(state, id);
  return state.players.filter((p) => p.team === team && p.id !== id).map((p) => p.id);
}

/** Malandragens que o jogador pode pedir agora, durante a mão. */
export function cheatOptions(state: GameState, id: PlayerId): CheatRequest[] {
  const h = state.hand;
  if (!state.options.cheats || !DURING_HAND.has(state.phase) || !h.active.includes(id)) return [];
  const cards = h.blind ? [] : (h.hands[id] ?? []);
  const charge = hasCharge(state, id);
  const options: CheatRequest[] = [];
  if (charge && state.stock.length > 0) {
    for (const c of cards) options.push({ kind: 'manga', cardId: c.id });
  }
  if ((state.cheats.sleeves[id]?.length ?? 0) > 0) {
    for (const c of cards) options.push({ kind: 'usar_manga', cardId: c.id });
  }
  if (charge) {
    for (const target of neighborsOf(state, id)) {
      if (h.active.includes(target) && (h.hands[target]?.length ?? 0) > 0) options.push({ kind: 'espiar', target });
    }
  }
  if (charge && !h.passOffer && !h.blind) {
    for (const to of partnersOf(state, id)) {
      if (!h.active.includes(to) || (h.hands[to]?.length ?? 0) === 0) continue;
      for (const c of cards) options.push({ kind: 'passar', cardId: c.id, to });
    }
  }
  const team = teamOf(state, id);
  // O tento a mais nunca fecha a partida.
  if (charge && team !== null && state.score[team] + 1 < state.config.pointsToWin) options.push({ kind: 'ponto' });
  return options;
}

function requestKey(r: CheatRequest): string {
  switch (r.kind) {
    case 'manga':
    case 'usar_manga':
      return `${r.kind}|${r.cardId}`;
    case 'espiar':
      return `${r.kind}|${r.target}`;
    case 'passar':
      return `${r.kind}|${r.cardId}|${r.to}`;
    default:
      return r.kind;
  }
}

/** Baralho viciado: o pé pode escolher uma carta do baralho para o topo ou o fundo. */
export function canStackDeck(state: GameState, id: PlayerId, cardId: unknown, position: unknown): boolean {
  return (
    state.options.cheats &&
    hasCharge(state, id) &&
    (position === 'topo' || position === 'fundo') &&
    typeof cardId === 'string' &&
    (state.deck ?? []).some((c) => c.id === cardId)
  );
}

export function canPeekCut(state: GameState, id: PlayerId): boolean {
  return state.options.cheats && hasCharge(state, id);
}

/** Confere uma ação de malandragem, resposta ao passe, denúncia ou fechamento de janela. */
export function isCheatLegal(state: GameState, action: CheatAction): boolean {
  const h = state.hand;
  switch (action.type) {
    case 'MALANDRAGEM': {
      const cheat = action.cheat as CheatRequest | undefined;
      if (!cheat || typeof cheat !== 'object') return false;
      const key = requestKey(cheat);
      return cheatOptions(state, action.playerId).some((o) => requestKey(o) === key);
    }
    case 'RESPONDER_PASSE': {
      const offer = h.passOffer;
      if (!offer || offer.to !== action.playerId || !DURING_HAND.has(state.phase)) return false;
      if (!(h.hands[offer.from] ?? []).some((c) => c.id === offer.cardId)) return false;
      if (action.cardId === null) return true;
      return hasCharge(state, offer.from) && (h.hands[action.playerId] ?? []).some((c) => c.id === action.cardId);
    }
    case 'DENUNCIAR': {
      const mine = teamOf(state, action.playerId);
      const theirs = teamOf(state, action.target);
      return state.options.cheats && state.phase !== 'fim_de_partida' && mine !== null && theirs !== null && mine !== theirs;
    }
    case 'FECHAR_MALANDRAGEM':
      return state.cheats.records.some((r) => r.id === action.id && r.by === action.playerId && r.open);
  }
}

/** Troca uma carta da mão (e da lista de cartas recebidas, que conta no envido e na flor). */
function replaceCard(h: HandState, id: PlayerId, oldId: string, card: Card): boolean {
  const hand = h.hands[id] ?? [];
  const index = hand.findIndex((c) => c.id === oldId);
  if (index < 0) return false;
  hand[index] = card;
  const dealt = h.dealt[id] ?? [];
  const d = dealt.findIndex((c) => c.id === oldId);
  if (d >= 0) dealt[d] = card;
  return true;
}

const holds = (h: HandState, id: PlayerId, cardId: string): boolean => (h.hands[id] ?? []).some((c) => c.id === cardId);

/** Registra a malandragem, gasta uma das malandragens do jogador e faz o gesto. */
export function recordCheat(
  state: GameState,
  by: PlayerId,
  participants: PlayerId[],
  kind: CheatKind,
  undo: CheatUndo,
  events: GameEvent[],
  charge = true,
): void {
  const id = state.cheats.nextId++;
  if (charge) state.cheats.used[by] = (state.cheats.used[by] ?? 0) + 1;
  const record: CheatRecord = { id, by, participants, kind, handNumber: state.handNumber, open: true, undo };
  state.cheats.records.push(record);
  // Os registros fechados não servem para mais nada: guarda só os últimos.
  if (state.cheats.records.length > 40) state.cheats.records = state.cheats.records.filter((r) => r.open);
  for (const who of participants) {
    const seat = state.players.find((p) => p.id === who)?.seat ?? 0;
    events.push({ type: 'GESTO', playerId: who, gesture: GESTURES[(id * 3 + seat) % GESTURES.length] as GestureKind });
  }
}

function applyRequest(state: GameState, by: PlayerId, cheat: CheatRequest, events: GameEvent[]): void {
  const h = state.hand;
  switch (cheat.kind) {
    case 'manga': {
      const guarded = (h.hands[by] ?? []).find((c) => c.id === cheat.cardId) as Card;
      const drawn = state.stock.shift() as Card;
      replaceCard(h, by, guarded.id, drawn);
      (state.cheats.sleeves[by] ??= []).push(guarded);
      recordCheat(state, by, [by], 'manga', { kind: 'manga', guarded, drawn }, events);
      return;
    }
    case 'usar_manga': {
      const sleeve = state.cheats.sleeves[by] ?? [];
      const fromSleeve = sleeve.shift() as Card;
      const toSleeve = (h.hands[by] ?? []).find((c) => c.id === cheat.cardId) as Card;
      // A carta trocada sai do jogo nesta mão (não volta para a manga).
      replaceCard(h, by, toSleeve.id, fromSleeve);
      recordCheat(state, by, [by], 'usar_manga', { kind: 'usar_manga', fromSleeve, toSleeve }, events, false);
      return;
    }
    case 'espiar': {
      const cards = h.hands[cheat.target] ?? [];
      const pick = nextInt(state.rngState, cards.length);
      state.rngState = pick.state;
      state.reveals.push({ to: by, kind: 'espiar', card: cards[pick.value] as Card, owner: cheat.target });
      recordCheat(state, by, [by], 'espiar', { kind: 'espiar' }, events);
      return;
    }
    case 'passar':
      // O parceiro ainda precisa aceitar: nada acontece (nem gesto) até a resposta.
      h.passOffer = { from: by, to: cheat.to, cardId: cheat.cardId };
      return;
    case 'ponto': {
      const team = teamOf(state, by) as TeamId;
      state.score[team] += 1;
      recordCheat(state, by, [by], 'ponto', { kind: 'ponto', team }, events);
      return;
    }
  }
}

function answerPass(state: GameState, id: PlayerId, cardId: string | null, events: GameEvent[]): void {
  const h = state.hand;
  const offer = h.passOffer;
  h.passOffer = null;
  if (!offer || cardId === null) return;
  const aCard = (h.hands[offer.from] ?? []).find((c) => c.id === offer.cardId) as Card;
  const bCard = (h.hands[id] ?? []).find((c) => c.id === cardId) as Card;
  replaceCard(h, offer.from, aCard.id, bCard);
  replaceCard(h, id, bCard.id, aCard);
  recordCheat(state, offer.from, [offer.from, id], 'passar', { kind: 'passar', a: offer.from, aCard, b: id, bCard }, events);
}

/** Desfaz o que der para desfazer. Cartas só voltam atrás dentro da mesma mão. */
function undoCheat(state: GameState, record: CheatRecord): void {
  const h = state.hand;
  const sameHand = record.handNumber === state.handNumber;
  const u = record.undo;
  switch (u.kind) {
    case 'manga': {
      const sleeve = state.cheats.sleeves[record.by] ?? [];
      const index = sleeve.findIndex((c) => c.id === u.guarded.id);
      if (index >= 0) sleeve.splice(index, 1);
      if (index >= 0 && sameHand && replaceCard(h, record.by, u.drawn.id, u.guarded)) state.stock.unshift(u.drawn);
      return;
    }
    case 'usar_manga':
      if (sameHand && replaceCard(h, record.by, u.fromSleeve.id, u.toSleeve)) {
        (state.cheats.sleeves[record.by] ??= []).unshift(u.fromSleeve);
      }
      return;
    case 'passar':
      if (sameHand && holds(h, u.b, u.aCard.id) && holds(h, u.a, u.bCard.id)) {
        replaceCard(h, u.b, u.aCard.id, u.bCard);
        replaceCard(h, u.a, u.bCard.id, u.aCard);
      }
      return;
    case 'ponto':
      state.score[u.team] = Math.max(0, state.score[u.team] - 1);
      return;
    case 'viciado':
      // Ainda dá tempo de embaralhar de novo antes de distribuir.
      if (state.deck && (state.phase === 'embaralhando' || state.phase === 'cortando')) {
        const step = shuffle(state.deck, state.rngState);
        state.deck = step.items;
        state.rngState = step.state;
      }
      return;
    default:
      return;
  }
}

function denounce(state: GameState, by: PlayerId, target: PlayerId, events: GameEvent[]): void {
  const open = state.cheats.records.filter((r) => r.open && r.participants.includes(target));
  const caught = open[open.length - 1];
  if (caught) {
    undoCheat(state, caught);
    caught.open = false;
    const team = teamOf(state, caught.by) as TeamId;
    state.score[team] = Math.max(0, state.score[team] - CHEAT_PENALTY);
    events.push({ type: 'PEGA_LADRAO', by, target, correct: true, kind: caught.kind, penalty: { team, points: CHEAT_PENALTY } });
    return;
  }
  const team = teamOf(state, by) as TeamId;
  state.score[team] = Math.max(0, state.score[team] - FALSE_ACCUSATION_PENALTY);
  events.push({ type: 'PEGA_LADRAO', by, target, correct: false, kind: null, penalty: { team, points: FALSE_ACCUSATION_PENALTY } });
}

/** Aplica uma ação de malandragem já conferida por isCheatLegal. */
export function applyCheatAction(state: GameState, action: CheatAction, events: GameEvent[]): void {
  switch (action.type) {
    case 'MALANDRAGEM':
      return applyRequest(state, action.playerId, action.cheat, events);
    case 'RESPONDER_PASSE':
      return answerPass(state, action.playerId, action.cardId, events);
    case 'DENUNCIAR':
      return denounce(state, action.playerId, action.target, events);
    case 'FECHAR_MALANDRAGEM': {
      const record = state.cheats.records.find((r) => r.id === action.id);
      if (record) record.open = false;
      return;
    }
  }
}

/** Guarda só os campos que importam de uma ação de malandragem. */
export function cleanCheatAction(action: CheatAction): CheatAction {
  switch (action.type) {
    case 'MALANDRAGEM': {
      const c = (action.cheat ?? {}) as Partial<Record<string, unknown>>;
      const pick = (keys: string[]): CheatRequest =>
        Object.fromEntries(keys.filter((k) => k in c).map((k) => [k, c[k]])) as unknown as CheatRequest;
      const cheat = pick(['kind', 'cardId', 'target', 'to']);
      return { type: action.type, playerId: action.playerId, cheat };
    }
    case 'RESPONDER_PASSE':
      return { type: action.type, playerId: action.playerId, cardId: action.cardId ?? null };
    case 'DENUNCIAR':
      return { type: action.type, playerId: action.playerId, target: action.target };
    case 'FECHAR_MALANDRAGEM':
      return { type: action.type, playerId: action.playerId, id: action.id };
  }
}
