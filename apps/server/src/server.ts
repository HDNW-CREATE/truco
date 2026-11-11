import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import type {
  AvatarConfig,
  ClientToServerEvents,
  ModeId,
  RoomSettings,
  ServerToClientEvents,
  SocketAuth,
  TableFormat,
} from '@truco/shared';
import { MODE_IDS, PLAYERS_PER_FORMAT } from '@truco/engine';
import { registerAuthRoutes, verifyToken } from './auth';
import { createDb, type Db } from './db';
import { DEFAULT_TIMING, Room, type Io, type Member, type Timing } from './room';

export interface ServerOptions {
  port?: number;
  jwtSecret?: string;
  /** URL do banco; "none" desliga contas e ranking. */
  dbUrl?: string;
  timing?: Partial<Timing>;
  logger?: boolean;
}

export interface RunningServer {
  app: FastifyInstance;
  io: Io;
  port: number;
  rooms: Map<string, Room>;
  close: () => Promise<void>;
}

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function newCode(rooms: Map<string, Room>): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

const DEFAULT_AVATAR: AvatarConfig = {
  skin: '#c68a5e',
  hair: '#3b2a1e',
  shirt: '#2f5d9b',
  hat: 'nenhum',
  glasses: false,
  mustache: false,
};

function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name.trim().slice(0, 16) : '';
  return text || 'Convidado';
}

function cleanAvatar(avatar: unknown): AvatarConfig {
  const a = (avatar ?? {}) as Partial<AvatarConfig>;
  const color = (v: unknown, fallback: string): string =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  const hats: AvatarConfig['hat'][] = ['nenhum', 'palha', 'bone', 'gaucho', 'boina'];
  return {
    skin: color(a.skin, DEFAULT_AVATAR.skin),
    hair: color(a.hair, DEFAULT_AVATAR.hair),
    shirt: color(a.shirt, DEFAULT_AVATAR.shirt),
    hat: hats.includes(a.hat as AvatarConfig['hat']) ? (a.hat as AvatarConfig['hat']) : 'nenhum',
    glasses: a.glasses === true,
    mustache: a.mustache === true,
  };
}

/** Confere as configurações vindas do cliente e devolve uma versão segura. */
export function cleanSettings(input: unknown): RoomSettings | null {
  const s = (input ?? {}) as Partial<RoomSettings>;
  if (!MODE_IDS.includes(s.modeId as ModeId)) return null;
  if (!PLAYERS_PER_FORMAT[s.format as TableFormat]) return null;
  const o = s.options ?? {};
  const points = Number(o.pointsToWin);
  return {
    modeId: s.modeId as ModeId,
    format: s.format as TableFormat,
    options: {
      sujo: o.sujo === true,
      coringa: o.coringa === true,
      manilhaVelha: o.manilhaVelha === true,
      ...(typeof o.flor === 'boolean' ? { flor: o.flor } : {}),
      ...(typeof o.sinais === 'boolean' ? { sinais: o.sinais } : {}),
      ...(Number.isInteger(points) && points >= 3 && points <= 40 ? { pointsToWin: points } : {}),
    },
    turnSeconds: s.turnSeconds === 15 || s.turnSeconds === 60 ? s.turnSeconds : 30,
    botLevel: s.botLevel === 'facil' || s.botLevel === 'dificil' ? s.botLevel : 'medio',
    fillWithBots: s.fillWithBots !== false,
    isPublic: s.isPublic === true,
    scenario: s.scenario === 'galpao' || s.scenario === 'bar' ? s.scenario : 'boteco',
    shuffleCut: s.shuffleCut === true,
    cutter: s.cutter === 'mao' ? 'mao' : 'esquerda',
    cheats: s.cheats === true,
    cheatLimit: Number.isInteger(s.cheatLimit) && Number(s.cheatLimit) >= 1 && Number(s.cheatLimit) <= 10 ? Number(s.cheatLimit) : 3,
  };
}

/** Limite de mensagens por conexão: um balde que enche aos poucos. */
class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export async function createServer(options: ServerOptions = {}): Promise<RunningServer> {
  const secret = options.jwtSecret ?? process.env.JWT_SECRET ?? 'troque-este-segredo-em-producao';
  const timing: Timing = { ...DEFAULT_TIMING, ...options.timing };
  const db: Db | null = options.dbUrl === 'none' ? null : createDb(options.dbUrl);

  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, { origin: true });
  app.get('/api/health', async () => ({ ok: true, salas: rooms.size }));
  if (db) registerAuthRoutes(app, db, secret);

  // Em produção, o próprio servidor entrega o cliente já compilado.
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(here, '../../client/dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) return reply.code(404).send({ error: 'Não encontrado' });
      return reply.sendFile('index.html');
    });
  }

  const io: Io = new Server(app.server, { cors: { origin: true } });
  const rooms = new Map<string, Room>();
  const bySocket = new Map<string, Room>();
  const log = (message: string, data?: object): void => app.log.info(data ?? {}, message);

  const createRoom = (settings: RoomSettings): Room => {
    const room = new Room(newCode(rooms), settings, io, timing, db, (r) => rooms.delete(r.code), log);
    rooms.set(room.code, room);
    return room;
  };

  io.on('connection', (socket: AppSocket) => {
    const auth = socket.handshake.auth as SocketAuth;
    const user = verifyToken(secret, auth.token);
    const limiter = new RateLimiter(30, 15);
    const headLimiter = new RateLimiter(12, 12);
    const gestureLimiter = new RateLimiter(2, 0.5);
    const room = (): Room | undefined => bySocket.get(socket.id);
    const member = (name: unknown, avatar: unknown): Member => ({
      socketId: socket.id,
      name: user?.name ?? cleanName(name),
      avatar: cleanAvatar(avatar),
      userId: user?.userId ?? null,
    });
    /** Envolve cada evento: aplica o limite de mensagens e protege contra dados malformados. */
    const guarded =
      <A extends unknown[]>(handler: (...args: A) => void) =>
      (...args: A): void => {
        if (!limiter.take()) return;
        try {
          handler(...args);
        } catch (error) {
          app.log.warn({ erro: String(error) }, 'evento inválido');
        }
      };
    const leaveCurrent = (): void => {
      room()?.leave(socket.id);
      bySocket.delete(socket.id);
    };

    // Reconexão: volta para o mesmo lugar se a sessão ainda existir.
    if (auth.session) {
      for (const r of rooms.values()) {
        const seat = r.findSession(auth.session);
        if (seat) {
          bySocket.set(socket.id, r);
          r.reconnect(seat, socket.id);
          break;
        }
      }
    }

    socket.on('room:create', guarded((data, ack) => {
      const settings = cleanSettings(data?.settings);
      if (!settings) return ack({ ok: false, error: 'Configuração inválida' });
      leaveCurrent();
      const r = createRoom(settings);
      const session = r.addPlayer(member(data.name, data.avatar));
      if (!session) return ack({ ok: false, error: 'Não foi possível criar a sala' });
      bySocket.set(socket.id, r);
      ack({ ok: true, code: r.code, session });
    }));

    socket.on('room:join', guarded((data, ack) => {
      const r = rooms.get(String(data?.code ?? '').trim().toUpperCase());
      if (!r) return ack({ ok: false, error: 'Sala não encontrada' });
      leaveCurrent();
      const who = member(data.name, data.avatar);
      const session = data.spectator ? null : r.addPlayer(who);
      if (!session) r.addSpectator(who);
      bySocket.set(socket.id, r);
      ack({ ok: true, code: r.code, session: session ?? '' });
    }));

    socket.on('room:quick', guarded((data, ack) => {
      if (!MODE_IDS.includes(data?.modeId) || !PLAYERS_PER_FORMAT[data?.format]) {
        return ack({ ok: false, error: 'Modo inválido' });
      }
      leaveCurrent();
      const open = [...rooms.values()].find(
        (r) =>
          r.settings.isPublic &&
          r.status === 'sala' &&
          r.settings.modeId === data.modeId &&
          r.settings.format === data.format &&
          r.hasFreeSeat(),
      );
      const settings = cleanSettings({ modeId: data.modeId, format: data.format, isPublic: true });
      const r = open ?? createRoom(settings as RoomSettings);
      const session = r.addPlayer(member(data.name, data.avatar));
      if (!session) return ack({ ok: false, error: 'Sala cheia, tente de novo' });
      bySocket.set(socket.id, r);
      r.scheduleQuickStart();
      ack({ ok: true, code: r.code, session });
    }));

    socket.on('room:sit', guarded((data) => room()?.sit(socket.id, Number(data?.seat))));
    socket.on('room:ready', guarded((data) => room()?.setReady(socket.id, data?.ready === true)));
    socket.on('room:addBot', guarded((data) => room()?.addBot(socket.id, Number(data?.seat))));
    socket.on('room:removeBot', guarded((data) => room()?.removeBot(socket.id, Number(data?.seat))));
    socket.on('room:settings', guarded((data) => {
      const settings = cleanSettings(data);
      if (settings) room()?.updateSettings(socket.id, settings);
    }));
    socket.on('room:start', guarded(() => room()?.start(socket.id)));
    socket.on('room:rematch', guarded(() => room()?.rematch(socket.id)));
    socket.on('room:leave', guarded(() => leaveCurrent()));

    socket.on('game:action', guarded((action, ack) => {
      const error = room()?.handleAction(socket.id, action) ?? null;
      if (typeof ack !== 'function') return;
      if (error || !room()) ack({ ok: false, error: error ?? 'Você não está em uma sala' });
      else ack({ ok: true });
    }));

    socket.on('chat:send', guarded((data) => {
      room()?.chat(socket.id, String(data?.text ?? ''), data?.kind === 'emote' ? 'emote' : 'texto');
    }));
    socket.on('signal:send', guarded((data) => room()?.signal(socket.id, data?.signal)));
    socket.on('head:rotate', (data) => {
      if (headLimiter.take()) room()?.head(socket.id, Number(data?.yaw), Number(data?.pitch));
    });

    socket.on('gesture:fake', () => {
      if (gestureLimiter.take()) room()?.fakeGesture(socket.id);
    });

    socket.on('disconnect', () => {
      room()?.disconnect(socket.id);
      bySocket.delete(socket.id);
    });
  });

  await app.listen({ port: options.port ?? 3001, host: '0.0.0.0' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 3001);

  return {
    app,
    io,
    port,
    rooms,
    close: async () => {
      for (const r of [...rooms.values()]) r.close('Servidor encerrado');
      await io.close();
      await app.close();
      await db?.$disconnect();
    },
  };
}
