import type { Action, BotLevel, Card, CheatRequest, GameState, PlayerId, PlayerView, TeamId } from '@truco/shared';
import { createDeck } from '../cards/deck';
import { applyAction, DEFAULT_GAME_OPTIONS, MAX_CUTS, MAX_SHUFFLES } from '../game';
import { envidoValue, florValue } from '../rules/envido';
import { cardPower, cardStrength } from '../rules/strength';

export type { BotLevel };

export interface BotPersonality {
  /** 0 = cauteloso, 1 = pede truco com qualquer coisa. */
  aggression: number;
  /** 0 = nunca blefa, 1 = blefa muito. */
  bluff: number;
}

export interface BotOptions {
  level: BotLevel;
  personality?: BotPersonality;
  /** Fonte de números em [0, 1); permite testes reproduzíveis. */
  random?: () => number;
  /** Pode fazer malandragem (só bots de verdade; nunca no lugar de um humano que deixou o tempo acabar). */
  cheat?: boolean;
}

type PlayAction = Extract<Action, { type: 'JOGAR_CARTA' }>;

const teamOf = (view: PlayerView, id: PlayerId): TeamId =>
  view.players.find((p) => p.id === id)?.team ?? 0;

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function findAction<T extends Action['type']>(
  actions: readonly Action[],
  type: T,
  test: (a: Extract<Action, { type: T }>) => boolean = () => true,
): Extract<Action, { type: T }> | undefined {
  return actions.find(
    (a): a is Extract<Action, { type: T }> =>
      a.type === type && test(a as Extract<Action, { type: T }>),
  );
}

/** Força da mão de 0 a 1: média das duas melhores cartas, com bônus por vaza já vencida. */
function handPower(view: PlayerView): number {
  const cards = view.myCards ?? [];
  const powers = cards.map((c) => cardPower(view.config, view.turnedCard, c)).sort((a, b) => b - a);
  const top = powers.slice(0, 2);
  let power = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0.5;
  const mine = teamOf(view, view.me);
  for (const trick of view.tricks) {
    if (trick.winner === mine) power += 0.2;
    else if (trick.winner !== null && trick.winner !== 'empate') power -= 0.15;
  }
  return Math.max(0, Math.min(1, power));
}

/** Escolha de carta por heurística: ganha a vaza gastando o mínimo, ou descarta a pior. */
function heuristicCard(view: PlayerView, plays: PlayAction[]): PlayAction {
  const cards = view.myCards ?? [];
  const strength = (a: PlayAction): number => {
    const card = cards.find((c) => c.id === a.cardId);
    return card ? cardStrength(view.config, view.turnedCard, card) : 0;
  };
  const sorted = [...plays].sort((a, b) => strength(a) - strength(b));
  const lowest = sorted[0] as PlayAction;
  const highest = sorted[sorted.length - 1] as PlayAction;

  const trick = view.tricks[view.tricks.length - 1];
  const onTable = trick?.plays ?? [];
  if (onTable.length === 0) return view.tricks.length === 1 ? highest : (sorted[1] ?? highest);

  let best = -1;
  let bestTeam: TeamId | null = null;
  for (const play of onTable) {
    const s = play.card ? cardStrength(view.config, view.turnedCard, play.card) : -1;
    if (s > best) {
      best = s;
      bestTeam = teamOf(view, play.playerId);
    }
  }
  const isLast = onTable.length === view.active.length - 1;
  if (bestTeam === teamOf(view, view.me) && isLast) return lowest;
  return sorted.find((a) => strength(a) > best) ?? lowest;
}

// ---------- Simulação (nível difícil) ----------

function unseenCards(view: PlayerView): Card[] {
  const seen = new Set<string>();
  for (const c of view.myDealtCards ?? []) seen.add(c.id);
  if (view.turnedCard) seen.add(view.turnedCard.id);
  for (const trick of view.tricks) {
    for (const play of trick.plays) if (play.card) seen.add(play.card.id);
  }
  return createDeck(view.config.deck).filter((c) => !seen.has(c.id));
}

/** Monta um estado completo possível: sorteia as cartas que o bot não conhece. */
function sampleState(view: PlayerView, random: () => number): GameState {
  const pool = unseenCards(view);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as Card, pool[i] as Card];
  }
  const draw = (): Card => pool.pop() as Card;
  const hands: Record<PlayerId, Card[]> = {};
  for (const player of view.players) {
    hands[player.id] =
      player.id === view.me
        ? [...(view.myCards ?? [])]
        : Array.from({ length: view.cardCounts[player.id] ?? 0 }, draw);
  }
  return {
    config: view.config,
    format: view.format,
    players: view.players,
    seed: 0,
    options: DEFAULT_GAME_OPTIONS,
    rngState: 0,
    deck: null,
    score: [0, 0],
    handNumber: view.handNumber,
    picaPicaQueue: [],
    redondoPlayed: false,
    stock: [],
    cheats: { records: [], used: {}, sleeves: {}, nextId: 1 },
    reveals: [],
    phase: 'jogando',
    winner: null,
    history: [],
    hand: {
      dealerSeat: view.dealerSeat,
      prep: null,
      maoSeat: view.maoSeat,
      active: view.active,
      hands,
      dealt: hands,
      turnedCard: view.turnedCard,
      tricks: view.tricks.map((t) => ({
        winner: t.winner,
        plays: t.plays.map((p) => ({ ...p, card: p.card ?? draw() })),
      })),
      turn: view.turn,
      handValue: 1,
      trucoLevel: view.config.trucoLadder.length - 1,
      noTruco: true,
      lastRaiseBy: null,
      pendingBet: null,
      // Envido e flor fechados: a simulação só joga cartas.
      envido: { chain: [], resolved: true, points: 0 },
      flor: { declaredBy: [], resolved: true },
      winner: null,
      blind: false,
      maoDeOnzeTeam: null,
      picaPicaDuel: view.picaPicaDuel,
      passOffer: null,
    },
  };
}

/** Joga a mão até o fim com a heurística simples e diz se o time do bot venceu. */
function playout(start: GameState, me: PlayerId, first?: PlayAction): number {
  let state = start;
  const myTeam = state.players.find((p) => p.id === me)?.team ?? 0;
  let forced: PlayAction | undefined = first;
  for (let guard = 0; guard < 30 && state.phase === 'jogando'; guard++) {
    const id = state.hand.turn;
    const cards = state.hand.hands[id] ?? [];
    const plays = cards.map((c): PlayAction => ({ type: 'JOGAR_CARTA', playerId: id, cardId: c.id }));
    if (plays.length === 0) break;
    const fake = {
      config: state.config,
      players: state.players,
      active: state.hand.active,
      tricks: state.hand.tricks.map((t) => ({ winner: t.winner, plays: t.plays })),
      turnedCard: state.hand.turnedCard,
      myCards: cards,
      me: id,
    } as unknown as PlayerView;
    const action = forced && id === me ? forced : heuristicCard(fake, plays);
    forced = undefined;
    state = applyAction(state, action).state;
  }
  if (state.hand.winner === null) return 0.5;
  return state.hand.winner === myTeam ? 1 : 0;
}

/** Chance estimada de o time do bot ganhar a mão, opcionalmente começando por uma carta. */
export function estimateWinChance(
  view: PlayerView,
  random: () => number,
  first?: PlayAction,
  samples = 30,
): number {
  if (view.blind || !view.myCards) return 0.5;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const state = sampleState(view, random);
    if (state.hand.turn !== view.me && first) return 0.5;
    total += playout(state, view.me, first);
  }
  return total / samples;
}

// ---------- Decisão ----------

function strengthFor(view: PlayerView, options: Required<BotOptions>): number {
  return options.level === 'dificil' ? estimateWinChance(view, options.random) : handPower(view);
}

function answerBet(view: PlayerView, options: Required<BotOptions>): Action {
  const { random, personality, level } = options;
  const actions = view.legalActions;
  const yes = findAction(actions, 'RESPONDER', (a) => a.accept);
  const no = findAction(actions, 'RESPONDER', (a) => !a.accept) as Action;
  const pending = view.pendingBet;
  const dealt = view.myDealtCards ?? [];

  if (pending?.kind === 'flor') {
    const flor = findAction(actions, 'CANTAR_FLOR', (a) => a.step === 'flor');
    if (flor) return flor;
    const value = florValue(view.config, view.turnedCard, dealt);
    return value >= 30 && yes ? yes : no;
  }

  if (pending?.kind === 'envido') {
    if (level === 'facil') return random() < 0.3 && yes ? yes : no;
    const value = envidoValue(view.config, view.turnedCard, dealt);
    const isFalta = pending.step === view.config.envido?.faltaName;
    const need = (isFalta ? 30 : 26) - personality.aggression * 2;
    return value >= need && yes ? yes : no;
  }

  // Truco
  if (level === 'facil') return random() < 0.35 && yes ? yes : no;
  const power = strengthFor(view, options);
  const raise = findAction(actions, 'PEDIR_TRUCO');
  if (raise && power > 0.85 - personality.aggression * 0.1) return raise;
  if (yes && power > 0.5 - personality.aggression * 0.12) return yes;
  return no;
}

/** Decide a ação de um bot olhando só para a visão dele (nunca para cartas escondidas). */
export function chooseBotAction(view: PlayerView, input: BotOptions): Action {
  const options: Required<BotOptions> = {
    level: input.level,
    personality: input.personality ?? { aggression: 0.5, bluff: 0.3 },
    random: input.random ?? Math.random,
    cheat: input.cheat ?? false,
  };
  const canCheat = options.cheat && (view.cheatsLeft ?? 0) > 0;
  const { random, personality, level } = options;
  const actions = view.legalActions;
  if (actions.length === 0) throw new Error('O bot não tem ação disponível');

  // Embaralhar e cortar: os mais agitados embaralham mais vezes; os calmos batem na mesa mais vezes.
  if (view.phase === 'embaralhando') {
    const times = Math.min(MAX_SHUFFLES, 2 + Math.floor(random() * (3 + personality.aggression * 4)));
    // Baralho viciado: manda a carta mais forte para o topo ou o fundo.
    if (canCheat && view.deckFaceUp?.length && random() < personality.bluff * 0.4) {
      const best = [...view.deckFaceUp].sort((a, b) => cardPower(view.config, null, b) - cardPower(view.config, null, a))[0] as Card;
      return { type: 'EMBARALHAR', playerId: view.me, times, stack: { cardId: best.id, position: random() < 0.5 ? 'topo' : 'fundo' } };
    }
    return { type: 'EMBARALHAR', playerId: view.me, times };
  }
  if (view.phase === 'cortando') {
    const size = view.prep?.deckSize ?? 40;
    const roll = random();
    if (roll < 0.1 + (1 - personality.aggression) * 0.1) return { type: 'CORTAR', playerId: view.me, cuts: [] };
    const count = roll < 0.8 ? 1 : 2 + Math.floor(random() * (MAX_CUTS - 1));
    const cuts = Array.from({ length: count }, () => 5 + Math.floor(random() * (size - 10)));
    const peek = canCheat && random() < personality.bluff * 0.3;
    return { type: 'CORTAR', playerId: view.me, cuts, ...(peek ? { peek: true } : {}) };
  }

  if (view.phase === 'decisao_mao_de_onze') {
    const cards = [...(view.myCards ?? []), ...Object.values(view.partnerCards ?? {}).flat()];
    const strong = cards.filter((c) => cardPower(view.config, view.turnedCard, c) > 0.7).length;
    const play = level === 'facil' ? random() < 0.5 : strong >= 2;
    return findAction(actions, 'DECIDIR_MAO_DE_ONZE', (a) => a.play === play) as Action;
  }
  if (view.pendingBet) return answerBet(view, options);

  const flor = findAction(actions, 'CANTAR_FLOR');
  if (flor) return flor;

  const plays = actions.filter((a): a is PlayAction => a.type === 'JOGAR_CARTA' && !a.faceDown);
  if (view.blind || level === 'facil') {
    if (level === 'facil' && random() < 0.03) {
      const truco = findAction(actions, 'PEDIR_TRUCO');
      if (truco) return truco;
    }
    return pick(plays, random);
  }

  const dealt = view.myDealtCards ?? [];
  const envidoPoints = envidoValue(view.config, view.turnedCard, dealt);
  const callEnvido = (name: string): Action | undefined =>
    findAction(actions, 'CANTAR_ENVIDO', (a) => a.step === name);
  const steps = view.config.envido?.steps ?? [];
  if (steps[1] && envidoPoints >= 31) {
    const real = callEnvido(steps[1].name);
    if (real) return real;
  }
  if (steps[0] && (envidoPoints >= 28 - personality.aggression * 2 || random() < personality.bluff * 0.05)) {
    const envido = callEnvido(steps[0].name);
    if (envido) return envido;
  }

  const truco = findAction(actions, 'PEDIR_TRUCO');
  if (truco) {
    const power = strengthFor(view, options);
    if (power > 0.78 - personality.aggression * 0.15 || random() < personality.bluff * 0.08) {
      return truco;
    }
  }

  if (level === 'dificil' && plays.length > 1) {
    let best = plays[0] as PlayAction;
    let bestChance = -1;
    for (const play of plays) {
      const chance = estimateWinChance(view, random, play, 24);
      if (chance > bestChance) {
        bestChance = chance;
        best = play;
      }
    }
    // Empate entre opções: prefere a heurística (gasta a menor carta).
    const heuristic = heuristicCard(view, plays);
    return estimateWinChance(view, random, heuristic, 24) >= bestChance - 0.03 ? heuristic : best;
  }
  return heuristicCard(view, plays);
}

// ---------- Malandragens dos bots ----------

/**
 * Talvez faça uma malandragem antes de jogar. Quem blefa mais trapaceia mais.
 * Usa só a visão do bot (as próprias cartas e o que pode pedir).
 */
export function chooseBotCheat(view: PlayerView, input: BotOptions): CheatRequest | null {
  const random = input.random ?? Math.random;
  const personality = input.personality ?? { aggression: 0.5, bluff: 0.3 };
  const options = view.cheatOptions;
  if (options.length === 0) return null;
  const power = (id: string): number => {
    const card = view.myCards?.find((c) => c.id === id);
    return card ? cardPower(view.config, view.turnedCard, card) : 0;
  };
  // Carta na manga guardada: troca pela pior carta da mão, se a da manga for melhor.
  const sleeve = view.mySleeve[0];
  const use = options
    .filter((o): o is Extract<CheatRequest, { kind: 'usar_manga' }> => o.kind === 'usar_manga')
    .sort((a, b) => power(a.cardId) - power(b.cardId))[0];
  if (sleeve && use && cardPower(view.config, view.turnedCard, sleeve) > power(use.cardId) && random() < 0.7) return use;

  if (random() >= personality.bluff * 0.35) return null;
  const pickOf = <K extends CheatRequest['kind']>(kind: K) => options.filter((o) => o.kind === kind) as Extract<CheatRequest, { kind: K }>[];
  const candidates: CheatRequest[] = [];
  const ponto = pickOf('ponto')[0];
  if (ponto) candidates.push(ponto);
  const spy = pickOf('espiar');
  if (spy.length) candidates.push(pick(spy, random));
  // Guarda na manga a melhor carta, para uma mão futura.
  const guard = pickOf('manga').sort((a, b) => power(b.cardId) - power(a.cardId))[0];
  if (guard) candidates.push(guard);
  // Passa a pior carta para o parceiro (ele escolhe o que devolve).
  const pass = pickOf('passar').sort((a, b) => power(a.cardId) - power(b.cardId))[0];
  if (pass) candidates.push(pass);
  return candidates.length ? pick(candidates, random) : null;
}

/** Bot parceiro respondendo a um passe de carta: aceita às vezes e devolve a carta mais fraca. */
export function chooseBotPassResponse(view: PlayerView, random: () => number = Math.random): string | null {
  if (!view.incomingPass || !view.myCards?.length || random() >= 0.6) return null;
  const sorted = [...view.myCards].sort(
    (a, b) => cardPower(view.config, view.turnedCard, a) - cardPower(view.config, view.turnedCard, b),
  );
  return sorted[0]?.id ?? null;
}

/** Chance de um bot gritar "Pega ladrão!" depois de ver um gesto de um adversário. */
export function botDenounceChance(personality: BotPersonality = { aggression: 0.5, bluff: 0.3 }): number {
  return 0.15 + personality.aggression * 0.35;
}
