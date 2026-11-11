import type { Action, GameEvent, GameState, ModeConfig, TableFormat } from '@truco/shared';
import { applyAction, cardFromId, createGame, createPlayers } from '../src/index';

/** Cria uma partida com as mãos escolhidas. O lugar 0 dá as cartas... não: p0 é sempre o mão. */
export function setup(
  config: ModeConfig,
  hands: Record<string, string[]>,
  options: { format?: TableFormat; turned?: string; score?: [number, number] } = {},
): GameState {
  const players = createPlayers(options.format ?? '2x2');
  let state = createGame(config, players, 1);
  // Procura uma seed em que o p0 seja o mão, para os testes ficarem fáceis de ler.
  for (let seed = 1; state.hand.maoSeat !== 0; seed++) state = createGame(config, players, seed);
  const dealt = Object.fromEntries(
    players.map((p) => [p.id, (hands[p.id] ?? []).map(cardFromId)]),
  );
  return {
    ...state,
    score: options.score ?? [0, 0],
    hand: {
      ...state.hand,
      hands: structuredClone(dealt),
      dealt,
      turnedCard: options.turned ? cardFromId(options.turned) : state.hand.turnedCard,
    },
  };
}

export interface Run {
  state: GameState;
  events: GameEvent[];
}

/** Aplica várias ações em sequência e junta os eventos. */
export function run(state: GameState, actions: Action[]): Run {
  const events: GameEvent[] = [];
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

export const play = (playerId: string, cardId: string, faceDown = false): Action => ({
  type: 'JOGAR_CARTA',
  playerId,
  cardId,
  ...(faceDown ? { faceDown: true } : {}),
});
export const truco = (playerId: string): Action => ({ type: 'PEDIR_TRUCO', playerId });
export const quero = (playerId: string): Action => ({ type: 'RESPONDER', playerId, accept: true });
export const naoQuero = (playerId: string): Action => ({ type: 'RESPONDER', playerId, accept: false });
export const envido = (playerId: string, step = 'Envido'): Action => ({ type: 'CANTAR_ENVIDO', playerId, step });
