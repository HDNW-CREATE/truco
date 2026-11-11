import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import {
  ACHIEVEMENTS,
  type AuthResponse,
  type AvatarConfig,
  type ProfileResponse,
  type RankingEntry,
} from '@truco/shared';
import type { Db } from './db';

export interface TokenPayload {
  userId: number;
  name: string;
}

export function signToken(secret: string, payload: TokenPayload): string {
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

/** Devolve os dados do token ou null se for inválido. */
export function verifyToken(secret: string, token: string | undefined): TokenPayload | null {
  if (!token) return null;
  try {
    const data = jwt.verify(token, secret) as TokenPayload;
    return typeof data.userId === 'number' ? { userId: data.userId, name: data.name } : null;
  } catch {
    return null;
  }
}

export const levelOf = (xp: number): number => Math.floor(xp / 100) + 1;

function parseAvatar(json: string): AvatarConfig | null {
  try {
    const value = JSON.parse(json) as AvatarConfig;
    return value.skin ? value : null;
  } catch {
    return null;
  }
}

interface Credentials {
  email?: string;
  name?: string;
  password?: string;
}

/** Rotas de conta, perfil e ranking. */
export function registerAuthRoutes(app: FastifyInstance, db: Db, secret: string): void {
  app.post<{ Body: Credentials }>('/api/register', async (request, reply) => {
    const email = request.body.email?.trim().toLowerCase() ?? '';
    const name = request.body.name?.trim() ?? '';
    const password = request.body.password ?? '';
    if (!/^\S+@\S+\.\S+$/.test(email)) return reply.code(400).send({ error: 'E-mail inválido' });
    if (name.length < 3 || name.length > 16) {
      return reply.code(400).send({ error: 'O nome deve ter de 3 a 16 letras' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }
    const taken = await db.user.findFirst({ where: { OR: [{ email }, { name }] } });
    if (taken) return reply.code(409).send({ error: 'E-mail ou nome já cadastrado' });
    const user = await db.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 10) },
    });
    const body: AuthResponse = { token: signToken(secret, { userId: user.id, name }), name };
    return body;
  });

  app.post<{ Body: Credentials }>('/api/login', async (request, reply) => {
    const email = request.body.email?.trim().toLowerCase() ?? '';
    const user = await db.user.findUnique({ where: { email } });
    const valid = user && (await bcrypt.compare(request.body.password ?? '', user.passwordHash));
    if (!user || !valid) return reply.code(401).send({ error: 'E-mail ou senha incorretos' });
    const body: AuthResponse = {
      token: signToken(secret, { userId: user.id, name: user.name }),
      name: user.name,
    };
    return body;
  });

  app.get<{ Params: { name: string } }>('/api/profile/:name', async (request, reply) => {
    const user = await db.user.findUnique({
      where: { name: request.params.name },
      include: { stats: true, achievements: true },
    });
    if (!user) return reply.code(404).send({ error: 'Jogador não encontrado' });
    const body: ProfileResponse = {
      name: user.name,
      xp: user.xp,
      level: levelOf(user.xp),
      avatar: parseAvatar(user.avatar),
      stats: user.stats.map((s) => ({ mode: s.mode, games: s.games, wins: s.wins, elo: s.elo })),
      achievements: user.achievements.map((a) => ({
        key: a.key,
        title: ACHIEVEMENTS[a.key] ?? a.key,
        at: a.at.toISOString(),
      })),
    };
    return body;
  });

  app.put<{ Body: { avatar?: AvatarConfig } }>('/api/avatar', async (request, reply) => {
    const auth = verifyToken(secret, request.headers.authorization?.replace('Bearer ', ''));
    if (!auth || !request.body.avatar) return reply.code(401).send({ error: 'Faça login' });
    await db.user.update({
      where: { id: auth.userId },
      data: { avatar: JSON.stringify(request.body.avatar) },
    });
    return { ok: true };
  });

  app.get<{ Querystring: { mode?: string } }>('/api/ranking', async (request) => {
    const stats = await db.modeStat.findMany({
      where: { mode: request.query.mode ?? 'paulista', games: { gt: 0 } },
      orderBy: { elo: 'desc' },
      take: 50,
      include: { user: true },
    });
    const body: RankingEntry[] = stats.map((s) => ({
      name: s.user.name,
      elo: s.elo,
      games: s.games,
      wins: s.wins,
    }));
    return body;
  });
}
