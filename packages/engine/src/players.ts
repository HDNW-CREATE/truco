import type { Player, TableFormat, TeamId } from '@truco/shared';

export const PLAYERS_PER_FORMAT: Record<TableFormat, number> = { '1x1': 2, '2x2': 4, '3x3': 6 };

/**
 * Cria os jogadores de uma mesa. Os times se alternam pelos lugares, então no 2x2
 * o parceiro fica de frente e no 3x3 quem está de frente é sempre um adversário.
 */
export function createPlayers(
  format: TableFormat,
  names: readonly string[] = [],
  humanSeats: readonly number[] = [0],
): Player[] {
  const count = PLAYERS_PER_FORMAT[format];
  return Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    name: names[seat] ?? `Jogador ${seat + 1}`,
    seat,
    team: (seat % 2) as TeamId,
    isBot: !humanSeats.includes(seat),
  }));
}
