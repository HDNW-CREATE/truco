import type { Card, ModeConfig, Player, PlayerId, TeamId, Trick } from '@truco/shared';
import { cardStrength } from './strength';

export interface TrickOutcome {
  winner: TeamId | 'empate';
  /** Quem começa a vaza seguinte. */
  leader: PlayerId;
}

/**
 * Decide a vaza: vence a carta mais forte; se as mais fortes forem de times diferentes, empata.
 * Carta coberta não vale nada. No empate, quem abriu a vaza abre a próxima.
 */
export function resolveTrick(
  config: ModeConfig,
  turnedCard: Card | null,
  players: readonly Player[],
  trick: Trick,
): TrickOutcome {
  const first = trick.plays[0];
  if (!first) throw new Error('Vaza sem cartas');
  const teamOf = (id: PlayerId): TeamId => players.find((p) => p.id === id)?.team ?? 0;
  const strengths = trick.plays.map((p) =>
    p.faceDown ? -1 : cardStrength(config, turnedCard, p.card),
  );
  const max = Math.max(...strengths);
  const top = trick.plays.filter((_, i) => strengths[i] === max);
  const teams = new Set(top.map((p) => teamOf(p.playerId)));
  if (teams.size > 1) return { winner: 'empate', leader: first.playerId };
  const best = top[0] ?? first;
  return { winner: teamOf(best.playerId), leader: best.playerId };
}

/**
 * Resultado da mão a partir das vazas encerradas.
 * Retorna o time vencedor, 'ninguem' (três empates no truco brasileiro) ou null se ainda não acabou.
 */
export function handResult(
  winners: readonly (TeamId | 'empate')[],
  tieRule: ModeConfig['tieRule'],
  maoTeam: TeamId,
): TeamId | 'ninguem' | null {
  for (const team of [0, 1] as const) {
    if (winners.filter((w) => w === team).length >= 2) return team;
  }
  const [first, second, third] = winners;
  if (first === undefined || second === undefined) return null;
  if (first === 'empate') {
    if (second !== 'empate') return second;
    if (third === undefined) return null;
    if (third !== 'empate') return third;
    return tieRule === 'rioplatense' ? maoTeam : 'ninguem';
  }
  // A primeira teve vencedor: empate na segunda ou na terceira dá a mão a quem fez a primeira.
  if (second === 'empate') return first;
  if (third === undefined) return null;
  return third === 'empate' ? first : third;
}
