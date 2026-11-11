import type { GameState, RoomSettings, TeamId } from '@truco/shared';
import type { Db } from './db';

const K = 24;
const BOT_ELO = 1000;

/** Variação de ELO de um time, dada a média dele, a do adversário e o resultado. */
export function eloDelta(mine: number, theirs: number, won: boolean): number {
  const expected = 1 / (1 + 10 ** ((theirs - mine) / 400));
  return Math.round(K * ((won ? 1 : 0) - expected));
}

export interface MatchPlayer {
  seat: number;
  team: TeamId;
  name: string;
  userId: number | null;
  /** Conquistas que o jogador ganhou durante a partida. */
  earned: Set<string>;
}

export interface SavedResult {
  userId: number;
  newAchievements: string[];
}

/** Grava a partida, atualiza estatísticas, ELO, XP e conquistas dos jogadores com conta. */
export async function saveMatch(
  db: Db,
  settings: RoomSettings,
  state: GameState,
  players: MatchPlayer[],
  options: { ranked: boolean } = { ranked: true },
): Promise<SavedResult[]> {
  const winner = state.winner ?? 0;
  const mode = settings.modeId;
  await db.match.create({
    data: {
      mode,
      format: settings.format,
      seed: state.seed,
      winner,
      score: state.score.join('x'),
      replay: JSON.stringify({
        settings,
        players: players.map((p) => ({ seat: p.seat, name: p.name })),
        history: state.history,
      }),
    },
  });

  // Partida com malandragem fica gravada, mas não conta para ranking, ELO, XP nem conquistas.
  if (!options.ranked) return [];

  const elo = new Map<number, number>();
  for (const p of players) {
    if (p.userId === null) continue;
    const stat = await db.modeStat.upsert({
      where: { userId_mode: { userId: p.userId, mode } },
      create: { userId: p.userId, mode },
      update: {},
    });
    elo.set(p.seat, stat.elo);
  }
  const average = (team: TeamId): number => {
    const members = players.filter((p) => p.team === team);
    const total = members.reduce((sum, p) => sum + (elo.get(p.seat) ?? BOT_ELO), 0);
    return total / Math.max(1, members.length);
  };

  const results: SavedResult[] = [];
  for (const p of players) {
    if (p.userId === null) continue;
    const won = p.team === winner;
    const delta = eloDelta(average(p.team), average(p.team === 0 ? 1 : 0), won);
    const stat = await db.modeStat.update({
      where: { userId_mode: { userId: p.userId, mode } },
      data: { games: { increment: 1 }, wins: { increment: won ? 1 : 0 }, elo: { increment: delta } },
    });
    await db.user.update({ where: { id: p.userId }, data: { xp: { increment: won ? 25 : 10 } } });

    const keys = new Set(p.earned);
    if (won) {
      keys.add('primeira_vitoria');
      const all = await db.modeStat.aggregate({ where: { userId: p.userId }, _sum: { wins: true } });
      if ((all._sum.wins ?? stat.wins) >= 10) keys.add('dez_vitorias');
    }
    const fresh: string[] = [];
    for (const key of keys) {
      const exists = await db.achievement.findUnique({
        where: { userId_key: { userId: p.userId, key } },
      });
      if (!exists) {
        await db.achievement.create({ data: { userId: p.userId, key } });
        fresh.push(key);
      }
    }
    results.push({ userId: p.userId, newAchievements: fresh });
  }
  return results;
}
