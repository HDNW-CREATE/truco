import type {
  Action,
  Card,
  GameState,
  PlayerId,
  PlayerView,
  SpectatorView,
  ViewTrick,
} from '@truco/shared';
import { getLegalActions } from './game';
import { cheatOptions, cheatsLeft } from './rules/cheats';

/** Vazas como todos veem: carta coberta não revela valor nem naipe. */
function visibleTricks(state: GameState): ViewTrick[] {
  return state.hand.tricks.map((trick) => ({
    winner: trick.winner,
    plays: trick.plays.map((play) => ({
      playerId: play.playerId,
      faceDown: play.faceDown,
      card: play.faceDown ? null : play.card,
    })),
  }));
}

/** Visão de espectador: nunca inclui as cartas da mão de ninguém. */
export function getSpectatorView(state: GameState): SpectatorView {
  const h = state.hand;
  const cardCounts: Record<PlayerId, number> = {};
  for (const player of state.players) {
    cardCounts[player.id] = h.hands[player.id]?.length ?? 0;
  }
  return {
    config: state.config,
    format: state.format,
    players: state.players,
    active: h.active,
    handNumber: state.handNumber,
    winner: state.winner,
    trucoLevel: h.trucoLevel,
    noTruco: h.noTruco,
    lastRaiseBy: h.lastRaiseBy,
    blind: h.blind,
    maoDeOnzeTeam: h.maoDeOnzeTeam,
    picaPicaDuel: h.picaPicaDuel,
    cardCounts,
    turnedCard: h.turnedCard,
    tricks: visibleTricks(state),
    score: [state.score[0], state.score[1]],
    handValue: h.handValue,
    dealerSeat: h.dealerSeat,
    maoSeat: h.maoSeat,
    turn: h.turn,
    pendingBet: h.pendingBet,
    phase: state.phase,
    // Só quem embaralha, quem corta e as alturas: a ordem do baralho (state.deck) nunca sai daqui.
    prep: h.prep ? { ...h.prep, cuts: h.prep.cuts ? [...h.prep.cuts] : null } : null,
    tableOptions: { ...state.options },
  };
}

/** Cartas dos parceiros, liberadas só na decisão da mão de onze do próprio time. */
function partnerCardsFor(state: GameState, playerId: PlayerId): Record<PlayerId, Card[]> | null {
  const me = state.players.find((p) => p.id === playerId);
  if (!me || state.phase !== 'decisao_mao_de_onze' || state.hand.maoDeOnzeTeam !== me.team) {
    return null;
  }
  const result: Record<PlayerId, Card[]> = {};
  for (const player of state.players) {
    if (player.team === me.team && player.id !== me.id) {
      result[player.id] = [...(state.hand.hands[player.id] ?? [])];
    }
  }
  return result;
}

/** Na mão de ferro as ações de jogar carta usam só a posição ("oculta-0"), sem revelar a carta. */
function hideCardIds(state: GameState, playerId: PlayerId, actions: Action[]): Action[] {
  const cards = state.hand.hands[playerId] ?? [];
  return actions.map((a) =>
    a.type === 'JOGAR_CARTA'
      ? { ...a, cardId: `oculta-${cards.findIndex((c) => c.id === a.cardId)}` }
      : a,
  );
}

/**
 * Visão de um jogador: as próprias cartas e só a quantidade das cartas dos outros.
 * É o único formato de estado que pode sair do servidor para um cliente.
 */
export function getPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  if (!state.players.some((p) => p.id === playerId)) {
    throw new Error(`Jogador ${playerId} não está na mesa`);
  }
  const blind = state.hand.blind;
  const legal = getLegalActions(state, playerId);
  const offer = state.hand.passOffer;
  const offered = offer?.to === playerId ? state.hand.hands[offer.from]?.find((c) => c.id === offer.cardId) : undefined;
  return {
    ...getSpectatorView(state),
    me: playerId,
    myCards: blind ? null : [...(state.hand.hands[playerId] ?? [])],
    myDealtCards: blind ? null : [...(state.hand.dealt[playerId] ?? [])],
    partnerCards: partnerCardsFor(state, playerId),
    deckFaceUp:
      state.phase === 'embaralhando' && state.hand.prep?.shuffler === playerId && state.deck
        ? [...state.deck]
        : null,
    legalActions: blind ? hideCardIds(state, playerId, legal) : legal,
    cheatsLeft: cheatsLeft(state, playerId),
    mySleeve: [...(state.cheats.sleeves[playerId] ?? [])],
    // Só o que este jogador viu escondido; nunca o que os outros viram.
    myReveals: state.reveals.filter((r) => r.to === playerId).map((r) => ({ ...r })),
    incomingPass: offer && offered ? { from: offer.from, card: offered } : null,
    outgoingPass: offer?.from === playerId ? { to: offer.to, cardId: offer.cardId } : null,
    cheatOptions: cheatOptions(state, playerId),
  };
}
