import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Action,
  AuthResponse,
  AvatarConfig,
  ChatMessage,
  ClientToServerEvents,
  GameUpdate,
  GestureMessage,
  JoinResult,
  PlayerView,
  ProfileResponse,
  RankingEntry,
  RoomSettings,
  RoomState,
  ServerToClientEvents,
  SignalMessage,
  SocketAuth,
} from '@truco/shared';
import { chooseBotAction, replayGame } from '@truco/engine';
import { filterProfanity, type Room } from '../src/room';
import { eloDelta } from '../src/results';
import { cleanSettings, createServer, type RunningServer } from '../src/server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const avatar: AvatarConfig = { skin: '#c68a5e', hair: '#000000', shirt: '#ff0000', hat: 'bone', glasses: false, mustache: false };
const settings = (extra: Partial<RoomSettings> = {}): RoomSettings => ({
  modeId: 'paulista',
  options: {},
  format: '2x2',
  turnSeconds: 15,
  botLevel: 'medio',
  fillWithBots: true,
  isPublic: false,
  scenario: 'boteco',
  shuffleCut: false,
  cutter: 'esquerda',
  cheats: false,
  cheatLimit: 3,
  ...extra,
});

let server: RunningServer;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  // Banco de teste: cópia vazia do banco criado pelo "prisma db push".
  const dbFile = join(mkdtempSync(join(tmpdir(), 'truco-')), 'test.db');
  copyFileSync(join(__dirname, '../prisma/dev.db'), dbFile);
  server = await createServer({
    port: 0,
    dbUrl: `file:${dbFile}`,
    timing: { botDelay: [1, 3], nextHandDelay: 5, disconnectGrace: 150, quickFillDelay: 120 },
  });
  url = `http://localhost:${server.port}`;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

function open(auth: SocketAuth = {}): Promise<Client> {
  const socket: Client = connect(url, { auth, transports: ['websocket'], forceNew: true });
  clients.push(socket);
  return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
}

function create(socket: Client, name: string, s: RoomSettings): Promise<JoinResult> {
  return new Promise((resolve, reject) =>
    socket.emit('room:create', { name, avatar, settings: s }, (r) => (r.ok ? resolve(r) : reject(new Error(r.error)))),
  );
}

function joinRoom(socket: Client, code: string, name: string, spectator = false): Promise<JoinResult> {
  return new Promise((resolve, reject) =>
    socket.emit('room:join', { code, name, avatar, spectator }, (r) => (r.ok ? resolve(r) : reject(new Error(r.error)))),
  );
}

function waitFor<T>(socket: Client, event: keyof ServerToClientEvents, test: (value: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const handler = (value: T): void => {
      if (!test(value)) return;
      socket.off(event, handler as never);
      resolve(value);
    };
    socket.on(event, handler as never);
  });
}

const isPlayerView = (view: GameUpdate['view']): view is PlayerView => 'me' in view;

/** Faz o cliente jogar sozinho, como um bot, até a partida acabar. */
function autoplay(socket: Client, seen: GameUpdate[] = []): Promise<PlayerView> {
  return new Promise((resolve) => {
    socket.on('game:state', (update) => {
      seen.push(update);
      const view = update.view;
      if (!isPlayerView(view)) return;
      if (view.phase === 'fim_de_partida') return resolve(view);
      if (view.legalActions.length > 0) {
        socket.emit('game:action', chooseBotAction(view, { level: 'medio' }), () => {});
      }
    });
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  return { status: response.status, body: (await response.json()) as T };
}

describe('funções auxiliares', () => {
  it('filtra palavrões sem mexer no resto', () => {
    expect(filterProfanity('que merda de carta')).toBe('que ***** de carta');
    expect(filterProfanity('Truco, ladrão!')).toBe('Truco, ladrão!');
  });
  it('calcula o ELO', () => {
    expect(eloDelta(1000, 1000, true)).toBe(12);
    expect(eloDelta(1000, 1000, false)).toBe(-12);
    expect(eloDelta(1400, 1000, true)).toBeLessThan(5);
  });
  it('valida as configurações da sala', () => {
    expect(cleanSettings({ modeId: 'xadrez', format: '2x2' })).toBeNull();
    expect(cleanSettings({ modeId: 'paulista', format: '5x5' })).toBeNull();
    const clean = cleanSettings({ modeId: 'gauderio', format: '1x1', turnSeconds: 7, options: { pointsToWin: 9999, flor: false } });
    expect(clean).toMatchObject({ turnSeconds: 30, botLevel: 'medio', scenario: 'boteco' });
    expect(clean?.options.pointsToWin).toBeUndefined();
    expect(clean?.options.flor).toBe(false);
  });
});

describe('contas', () => {
  it('cadastra, faz login e recusa dados ruins', async () => {
    const bad = await api<{ error: string }>('/api/register', { method: 'POST', body: JSON.stringify({ email: 'x', name: 'Ana', password: '123456' }) });
    expect(bad.status).toBe(400);
    const ok = await api<AuthResponse>('/api/register', { method: 'POST', body: JSON.stringify({ email: 'ana@teste.com', name: 'Ana', password: 'segredo1' }) });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const again = await api('/api/register', { method: 'POST', body: JSON.stringify({ email: 'ana@teste.com', name: 'Ana2', password: 'segredo1' }) });
    expect(again.status).toBe(409);
    const wrong = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: 'ana@teste.com', password: 'errada' }) });
    expect(wrong.status).toBe(401);
    const login = await api<AuthResponse>('/api/login', { method: 'POST', body: JSON.stringify({ email: 'ana@teste.com', password: 'segredo1' }) });
    expect(login.body.name).toBe('Ana');
    expect((await api('/api/profile/Ninguem')).status).toBe(404);
  });
});

describe('partida online', () => {
  it('quatro jogadores jogam uma partida inteira, cada um só com a própria visão', async () => {
    const sockets = await Promise.all([open(), open(), open(), open()]);
    const [host, ...others] = sockets as [Client, Client, Client, Client];
    const { code } = await create(host, 'Zeca', settings({ fillWithBots: false }));
    expect(code).toMatch(/^[A-Z]{6}$/);
    await Promise.all(others.map((s, i) => joinRoom(s, code, `Jogador${i}`)));

    const seen: GameUpdate[][] = sockets.map(() => []);
    const finished = sockets.map((s, i) => autoplay(s, seen[i]));
    host.emit('room:start');
    const views = await Promise.all(finished);

    for (const view of views) {
      expect(view.winner).not.toBeNull();
      expect(Math.max(...view.score)).toBe(12);
      expect(view.score).toEqual(views[0]?.score);
    }
    expect(new Set(views.map((v) => v.me)).size).toBe(4);
    for (const updates of seen) {
      for (const update of updates) {
        const text = JSON.stringify(update);
        expect(text).not.toContain('"hands"');
        expect(text).not.toContain('"dealt"');
      }
    }
    // As cartas de um jogador nunca aparecem na visão de outro na mesma mão.
    const firstHands = seen.map((updates) => {
      const view = updates[0]?.view;
      return view && isPlayerView(view) ? (view.myCards ?? []).map((c) => c.id) : [];
    });
    expect(new Set(firstHands.flat()).size).toBe(12);
    expect(server.rooms.get(code)?.status).toBe('encerrada');
  }, 30000);

  it('recusa jogada fora da vez e iniciar sem ser o dono da sala', async () => {
    const [a, b] = await Promise.all([open(), open()]);
    const { code } = await create(a as Client, 'Dono', settings({ format: '1x1', fillWithBots: false }));
    await joinRoom(b as Client, code, 'Visita');
    b?.emit('room:start');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.rooms.get(code)?.status).toBe('sala');

    const first = waitFor<GameUpdate>(a as Client, 'game:state', () => true);
    const firstB = waitFor<GameUpdate>(b as Client, 'game:state', () => true);
    a?.emit('room:start');
    const [ua, ub] = await Promise.all([first, firstB]);
    const waiting = [
      [a, ua],
      [b, ub],
    ].find(([, u]) => isPlayerView((u as GameUpdate).view) && ((u as GameUpdate).view as PlayerView).legalActions.length === 0);
    const [socket, update] = waiting as [Client, GameUpdate];
    const view = update.view as PlayerView;
    const result = await new Promise<{ ok: boolean }>((resolve) =>
      socket.emit('game:action', { type: 'JOGAR_CARTA', playerId: view.me, cardId: view.myCards?.[0]?.id ?? '' }, resolve),
    );
    expect(result.ok).toBe(false);
  });

  it('um jogador contra bots joga até o fim, e a conta ganha estatísticas e ranking', async () => {
    const registered = await api<AuthResponse>('/api/register', { method: 'POST', body: JSON.stringify({ email: 'beto@teste.com', name: 'Beto', password: 'segredo1' }) });
    const socket = await open({ token: registered.body.token });
    const { code } = await create(socket, 'ignorado', settings({ modeId: 'gauderio', format: '1x1', options: { pointsToWin: 9 } }));
    const done = autoplay(socket);
    const roomState = waitFor<RoomState>(socket, 'room:state', (s) => s.status === 'jogando');
    const ended = waitFor<RoomState>(socket, 'room:state', (s) => s.status === 'encerrada');
    socket.emit('room:start');
    const state = await roomState;
    expect(state.seats[0]?.name).toBe('Beto');
    expect(state.seats[1]?.kind).toBe('bot');
    expect(state.seats[1]?.persona).toBeTruthy();
    const view = await done;
    expect(Math.max(...view.score)).toBe(9);
    await ended;
    await new Promise((r) => setTimeout(r, 300));

    const profile = await api<ProfileResponse>('/api/profile/Beto');
    expect(profile.body.stats).toEqual([expect.objectContaining({ mode: 'gauderio', games: 1 })]);
    expect(profile.body.xp).toBeGreaterThan(0);
    const ranking = await api<RankingEntry[]>('/api/ranking?mode=gauderio');
    expect(ranking.body[0]?.name).toBe('Beto');
    if (view.winner === 0) {
      expect(profile.body.achievements.map((a) => a.key)).toContain('primeira_vitoria');
      expect(profile.body.stats[0]?.elo).toBeGreaterThan(1000);
    } else {
      expect(profile.body.stats[0]?.elo).toBeLessThan(1000);
    }
    expect(server.rooms.get(code)?.status).toBe('encerrada');

    // Revanche: o dono volta a sala para a espera.
    const back = waitFor<RoomState>(socket, 'room:state', (s) => s.status === 'sala');
    socket.emit('room:rematch');
    expect((await back).status).toBe('sala');
  }, 30000);

  it('quem cai volta para o mesmo lugar; se demorar, o bot joga por ele', async () => {
    const socket = await open();
    const { code, session } = await create(socket, 'Caiu', settings({ format: '1x1', options: { pointsToWin: 12 } }));
    const first = waitFor<GameUpdate>(socket, 'game:state', () => true);
    socket.emit('room:start');
    await first;
    const handBefore = server.rooms.get(code)?.game?.history.length ?? 0;
    socket.close();
    // Passa do prazo de tolerância: o bot assume e a partida anda.
    await new Promise((r) => setTimeout(r, 500));
    const room = server.rooms.get(code);
    expect(room).toBeDefined();
    expect(room?.game?.history.length ?? 0).toBeGreaterThan(handBefore);

    // O ouvinte precisa existir antes de conectar: o servidor manda o estado na hora.
    const back: Client = connect(url, { auth: { session }, transports: ['websocket'], forceNew: true });
    clients.push(back);
    const update = await waitFor<GameUpdate>(back, 'game:state', () => true);
    expect(isPlayerView(update.view) && update.view.me).toBe('p0');
    back.emit('room:leave');
  }, 15000);

  it('espectador assiste sem ver a mão de ninguém', async () => {
    const [host, watcher] = await Promise.all([open(), open()]);
    const { code } = await create(host as Client, 'Jogador', settings({ format: '1x1' }));
    const started = waitFor<GameUpdate>(host as Client, 'game:state', () => true);
    host?.emit('room:start');
    await started;
    const update = waitFor<GameUpdate>(watcher as Client, 'game:state', () => true);
    const joined = await joinRoom(watcher as Client, code, 'Olheiro');
    expect(joined.session).toBe('');
    const view = (await update).view;
    expect(isPlayerView(view)).toBe(false);
    expect(JSON.stringify(view)).not.toContain('myCards');
    expect(view.cardCounts.p0).toBe(3);
  });

  it('partida rápida junta jogadores do mesmo modo e completa com bots', async () => {
    const [a, b] = await Promise.all([open(), open()]);
    const quick = (s: Client, name: string): Promise<JoinResult> =>
      new Promise((resolve, reject) =>
        s.emit('room:quick', { name, avatar, modeId: 'mineiro', format: '2x2' }, (r) => (r.ok ? resolve(r) : reject(new Error(r.error)))),
      );
    const started = waitFor<RoomState>(a as Client, 'room:state', (s) => s.status === 'jogando');
    const ra = await quick(a as Client, 'Rápido1');
    const rb = await quick(b as Client, 'Rápido2');
    expect(rb.code).toBe(ra.code);
    const state = await started;
    expect(state.seats.filter((s) => s?.kind === 'humano')).toHaveLength(2);
    expect(state.seats.filter((s) => s?.kind === 'bot')).toHaveLength(2);
    expect(state.settings.modeId).toBe('mineiro');
  });

  it('sala de espera: trocar de lugar, bots, configurações e sala inexistente', async () => {
    const [host, guest] = await Promise.all([open(), open()]);
    const { code } = await create(host as Client, 'Dono', settings());
    await expect(joinRoom(guest as Client, 'ZZZZZZ', 'X')).rejects.toThrow(/não encontrada/);
    await joinRoom(guest as Client, code.toLowerCase(), 'Visita');

    const moved = waitFor<RoomState>(guest as Client, 'room:state', (s) => s.yourSeat === 2);
    guest?.emit('room:sit', { seat: 2 });
    expect((await moved).seats[2]?.name).toBe('Visita');

    const withBot = waitFor<RoomState>(host as Client, 'room:state', (s) => s.seats[1]?.kind === 'bot');
    guest?.emit('room:addBot', { seat: 3 }); // quem não é dono não pode
    host?.emit('room:addBot', { seat: 1 });
    const state = await withBot;
    expect(state.seats[3]).toBeNull();

    const resized = waitFor<RoomState>(host as Client, 'room:state', (s) => s.seats.length === 2);
    host?.emit('room:settings', settings({ format: '1x1', modeId: 'espanhol' }));
    const small = await resized;
    expect(small.seats.map((s) => s?.name)).toEqual(['Dono', 'Visita']);
    expect(small.settings.modeId).toBe('espanhol');

    const left = waitFor<RoomState>(host as Client, 'room:state', (s) => s.seats[1] === null);
    guest?.emit('room:leave');
    await left;
  });

  it('chat filtrado e sinais: o parceiro sempre vê', async () => {
    const sockets = (await Promise.all([open(), open(), open(), open()])) as [Client, Client, Client, Client];
    const { code } = await create(sockets[0], 'A', settings({ modeId: 'gauderio', fillWithBots: false }));
    for (const [i, s] of sockets.slice(1).entries()) await joinRoom(s, code, `J${i}`);

    const message = waitFor<ChatMessage>(sockets[1], 'chat:message', (m) => m.kind === 'texto');
    sockets[0].emit('chat:send', { text: '  que merda  ' });
    expect(await message).toMatchObject({ name: 'A', text: 'que *****', seat: 0 });

    const started = waitFor<GameUpdate>(sockets[2], 'game:state', () => true);
    sockets[0].emit('room:start');
    await started;
    const signal = waitFor<SignalMessage>(sockets[2], 'signal', () => true);
    sockets[0].emit('signal:send', { signal: 'piscar' });
    expect(await signal).toEqual({ seat: 0, signal: 'piscar', clear: true });
    for (const s of sockets) s.emit('room:leave');
  });
});

describe('embaralhar e cortar', () => {
  const act = (socket: Client, action: Action): Promise<{ ok: boolean; error?: string }> =>
    new Promise((resolve) => socket.emit('game:action', action, (r) => resolve(r as { ok: boolean; error?: string })));
  const viewOf = (update: GameUpdate): PlayerView => {
    if (!isPlayerView(update.view)) throw new Error('esperava visão de jogador');
    return update.view;
  };

  it('a opção da sala é validada: desligada por padrão, e quem corta só pode ser esquerda ou mão', () => {
    expect(cleanSettings({ modeId: 'paulista', format: '2x2' })).toMatchObject({ shuffleCut: false, cutter: 'esquerda' });
    expect(cleanSettings({ modeId: 'paulista', format: '2x2', shuffleCut: true, cutter: 'mao' })).toMatchObject({ shuffleCut: true, cutter: 'mao' });
    expect(cleanSettings({ modeId: 'paulista', format: '2x2', shuffleCut: 'sim', cutter: 'qualquer' })).toMatchObject({ shuffleCut: false, cutter: 'esquerda' });
  });

  it('o pé embaralha, o adversário corta, e o servidor recusa quem não é da vez e cortes inválidos', async () => {
    const [a, b] = (await Promise.all([open(), open()])) as [Client, Client];
    const { code } = await create(a, 'Pé', settings({ format: '1x1', fillWithBots: false, shuffleCut: true }));
    await joinRoom(b, code, 'Corte');
    const firstA = waitFor<GameUpdate>(a, 'game:state', () => true);
    const firstB = waitFor<GameUpdate>(b, 'game:state', () => true);
    a.emit('room:start');
    const [ua, ub] = await Promise.all([firstA, firstB]);
    const view = viewOf(ua);
    expect(view.phase).toBe('embaralhando');
    expect(ua.events[0]).toMatchObject({ type: 'VEZ_DE_EMBARALHAR' });
    expect(view.myCards).toEqual([]);
    // Cronômetro de 10 s para a etapa, não o tempo da jogada.
    expect((ua.deadline ?? 0) - Date.now()).toBeLessThanOrEqual(10000);
    expect((ua.deadline ?? 0) - Date.now()).toBeGreaterThan(5000);

    const sockets = { p0: a, p1: b } as Record<string, Client>;
    const prep = view.prep as NonNullable<PlayerView['prep']>;
    const shuffler = sockets[prep.shuffler] as Client;
    const cutter = sockets[prep.cutter] as Client;
    expect(prep.shuffler).not.toBe(prep.cutter);
    expect(viewOf(ub).prep).toEqual(prep);
    // O pé vê o baralho recolhido aberto antes de embaralhar; quem corta, não.
    const shufflerFirst = prep.shuffler === 'p0' ? ua : ub;
    const cutterFirst = prep.shuffler === 'p0' ? ub : ua;
    expect(viewOf(shufflerFirst).deckFaceUp).toHaveLength(40);
    expect(viewOf(cutterFirst).deckFaceUp).toBeNull();

    expect((await act(cutter, { type: 'EMBARALHAR', playerId: prep.cutter, times: 3 })).ok).toBe(false);
    expect((await act(shuffler, { type: 'EMBARALHAR', playerId: prep.shuffler, times: 99 })).ok).toBe(false);
    const cutting = waitFor<GameUpdate>(cutter, 'game:state', (u) => u.view.phase === 'cortando');
    expect((await act(shuffler, { type: 'EMBARALHAR', playerId: 'p9', times: 4 })).ok).toBe(true);
    const cutView = viewOf(await cutting);
    expect(cutView.prep?.shuffles).toBe(4);
    expect(cutView.deckFaceUp).toBeNull();

    expect((await act(shuffler, { type: 'CORTAR', playerId: prep.shuffler, cuts: [5] })).ok).toBe(false);
    expect((await act(cutter, { type: 'CORTAR', playerId: prep.cutter, cuts: [1, 2, 3, 4] })).ok).toBe(false);
    expect((await act(cutter, { type: 'CORTAR', playerId: prep.cutter, cuts: [0] })).ok).toBe(false);
    const dealt = waitFor<GameUpdate>(a, 'game:state', (u) => u.view.phase === 'jogando');
    expect((await act(cutter, { type: 'CORTAR', playerId: prep.cutter, cuts: [12, 30] })).ok).toBe(true);
    const played = await dealt;
    expect(played.events.map((e) => e.type)).toEqual(['BARALHO_CORTADO', 'CARTAS_DISTRIBUIDAS']);
    expect(viewOf(played).myCards).toHaveLength(3);
    expect(played.view.turnedCard).not.toBeNull();

    const history = server.rooms.get(code)?.game?.history ?? [];
    expect(history.slice(-2)).toEqual([
      { type: 'EMBARALHAR', playerId: prep.shuffler, times: 4 },
      { type: 'CORTAR', playerId: prep.cutter, cuts: [12, 30] },
    ]);
    a.emit('room:leave');
    b.emit('room:leave');
  });

  it('se o tempo acabar o jogo embaralha e corta sozinho; com bots a partida vai até o fim e se repete pela seed', async () => {
    const fast = await createServer({
      port: 0,
      dbUrl: 'none',
      timing: { botDelay: [1, 3], nextHandDelay: 5, prepTime: 60 },
    });
    try {
      const socket: Client = connect(`http://localhost:${fast.port}`, { transports: ['websocket'], forceNew: true });
      clients.push(socket);
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
      const { code } = await create(socket, 'Parado', settings({ format: '2x2', shuffleCut: true, turnSeconds: 15 }));

      // O humano não faz nada nas etapas de embaralhar e cortar: o servidor assume depois de 60 ms.
      const seen: GameUpdate[] = [];
      const done = new Promise<PlayerView>((resolve) => {
        socket.on('game:state', (update) => {
          seen.push(update);
          const view = viewOf(update);
          if (view.phase === 'fim_de_partida') return resolve(view);
          if (view.phase === 'embaralhando' || view.phase === 'cortando') return;
          if (view.legalActions.length > 0) socket.emit('game:action', chooseBotAction(view, { level: 'medio' }), () => {});
        });
      });
      socket.emit('room:start');
      const end = await done;
      expect(Math.max(...end.score)).toBe(12);

      const events = seen.flatMap((u) => u.events);
      const hands = events.filter((e) => e.type === 'CARTAS_DISTRIBUIDAS').length;
      expect(events.filter((e) => e.type === 'BARALHO_EMBARALHADO')).toHaveLength(hands);
      expect(events.filter((e) => e.type === 'BARALHO_CORTADO')).toHaveLength(hands);
      // Em algum momento o humano foi o pé ou quem corta e o tempo dele acabou.
      const game = fast.rooms.get(code)?.game as NonNullable<Room['game']>;
      const mine = game.history.filter((h) => (h.type === 'EMBARALHAR' || h.type === 'CORTAR') && h.playerId === 'p0');
      expect(mine.length).toBeGreaterThan(0);

      const replay = replayGame(game.config, game.players, game.seed, game.history, game.options);
      expect(replay.score).toEqual(game.score);
      expect(replay.winner).toBe(game.winner);
    } finally {
      await fast.close();
    }
  }, 30000);
});

describe('malandragem', () => {
  const act = (socket: Client, action: Action): Promise<{ ok: boolean; error?: string }> =>
    new Promise((resolve) => socket.emit('game:action', action, (r) => resolve(r as { ok: boolean; error?: string })));
  const viewOf = (update: GameUpdate): PlayerView => {
    if (!isPlayerView(update.view)) throw new Error('esperava visão de jogador');
    return update.view;
  };

  /** Dois humanos no mano a mano, com malandragem liberada. */
  async function duo(target: RunningServer, extra: Partial<RoomSettings> = {}): Promise<{ a: Client; b: Client; code: string; seen: { a: GameUpdate[]; b: GameUpdate[] } }> {
    const connectTo = (): Promise<Client> => {
      const socket: Client = connect(`http://localhost:${target.port}`, { transports: ['websocket'], forceNew: true });
      clients.push(socket);
      return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
    };
    const [a, b] = await Promise.all([connectTo(), connectTo()]);
    const { code } = await create(a, 'Malandro', settings({ format: '1x1', fillWithBots: false, cheats: true, ...extra }));
    await joinRoom(b, code, 'Esperto');
    const seen = { a: [] as GameUpdate[], b: [] as GameUpdate[] };
    a.on('game:state', (u) => seen.a.push(u));
    b.on('game:state', (u) => seen.b.push(u));
    const started = waitFor<GameUpdate>(b, 'game:state', () => true);
    a.emit('room:start');
    await started;
    return { a, b, code, seen };
  }

  it('a opção é validada: desligada por padrão e de 1 a 10 malandragens', () => {
    expect(cleanSettings({ modeId: 'paulista', format: '2x2' })).toMatchObject({ cheats: false, cheatLimit: 3 });
    expect(cleanSettings({ modeId: 'paulista', format: '2x2', cheats: true, cheatLimit: 7 })).toMatchObject({ cheats: true, cheatLimit: 7 });
    expect(cleanSettings({ modeId: 'paulista', format: '2x2', cheats: 1, cheatLimit: 50 })).toMatchObject({ cheats: false, cheatLimit: 3 });
  });

  it('o gesto chega aos outros sem dizer qual foi a malandragem, e o "Pega ladrão!" desfaz e tira 2 pontos', async () => {
    const { a, b } = await duo(server);
    const gesture = waitFor<GestureMessage>(b, 'gesture', () => true);
    let selfGesture = false;
    a.on('gesture', () => (selfGesture = true));
    const scored = waitFor<GameUpdate>(b, 'game:state', (u) => u.view.score[0] === 1);
    expect((await act(a, { type: 'MALANDRAGEM', playerId: 'p0', cheat: { kind: 'ponto' } })).ok).toBe(true);
    const message = await gesture;
    expect(message.seat).toBe(0);
    expect(Object.keys(message).sort()).toEqual(['gesture', 'seat']);
    const update = await scored;
    // O evento de gesto não vai junto com o estado.
    expect(update.events.some((e) => (e as { type: string }).type === 'GESTO')).toBe(false);
    expect(selfGesture).toBe(false);

    const caught = waitFor<GameUpdate>(a, 'game:state', (u) => u.events.some((e) => e.type === 'PEGA_LADRAO'));
    expect((await act(b, { type: 'DENUNCIAR', playerId: 'p1', target: 'p0' })).ok).toBe(true);
    const result = await caught;
    expect(result.events).toContainEqual({ type: 'PEGA_LADRAO', by: 'p1', target: 'p0', correct: true, kind: 'ponto', penalty: { team: 0, points: 2 } });
    expect(result.view.score).toEqual([0, 0]);
    // O cliente não pode fechar a janela de denúncia.
    expect((await act(a, { type: 'FECHAR_MALANDRAGEM', playerId: 'p0', id: 1 })).ok).toBe(false);
    a.emit('room:leave');
    b.emit('room:leave');
  });

  it('malandragem escondida não manda atualização para quem não viu nada; depois de 5 s a denúncia é falsa', async () => {
    const fast = await createServer({ port: 0, dbUrl: 'none', timing: { botDelay: [1, 3], cheatWindow: 150, passTimeout: 200 } });
    try {
      const { a, b, seen } = await duo(fast);
      const before = seen.b.length;
      const spied = waitFor<GameUpdate>(a, 'game:state', (u) => viewOf(u).myReveals.length > 0);
      const gesture = waitFor<GestureMessage>(b, 'gesture', () => true);
      expect((await act(a, { type: 'MALANDRAGEM', playerId: 'p0', cheat: { kind: 'espiar', target: 'p1' } })).ok).toBe(true);
      const reveal = viewOf(await spied).myReveals[0];
      expect(reveal?.owner).toBe('p1');
      expect(viewOf(seen.b[seen.b.length - 1] as GameUpdate).myCards?.map((c) => c.id)).toContain(reveal?.card.id);
      await gesture;
      await new Promise((r) => setTimeout(r, 300));
      // O espiado recebeu o gesto, mas nenhuma atualização de estado.
      expect(seen.b.length).toBe(before);

      // A janela (150 ms aqui) já fechou: agora é acusação falsa.
      const accused = waitFor<GameUpdate>(b, 'game:state', (u) => u.events.some((e) => e.type === 'PEGA_LADRAO'));
      await act(b, { type: 'DENUNCIAR', playerId: 'p1', target: 'p0' });
      expect((await accused).events[0]).toMatchObject({ type: 'PEGA_LADRAO', correct: false });
    } finally {
      await fast.close();
    }
  });

  it('bots malandros jogam até o fim, e a partida não conta para ranking nem ELO', async () => {
    const registered = await api<AuthResponse>('/api/register', { method: 'POST', body: JSON.stringify({ email: 'malandro@teste.com', name: 'Malandro', password: 'segredo1' }) });
    // Mesa de 4 com três bots: eles trapaceiam, passam carta entre parceiros e denunciam.
    const socket = await open({ token: registered.body.token });
    const gestures: GestureMessage[] = [];
    socket.on('gesture', (g) => gestures.push(g));
    const seen: GameUpdate[] = [];
    const { code } = await create(socket, 'x', settings({ format: '2x2', cheats: true, cheatLimit: 10, botLevel: 'medio', options: { pointsToWin: 6 } }));
    const done = autoplay(socket, seen);
    socket.emit('room:start');
    const view = await done;
    expect(Math.max(...view.score)).toBe(6);
    expect(gestures.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    const profile = await api<ProfileResponse>('/api/profile/Malandro');
    expect(profile.body.stats).toEqual([]);
    expect(profile.body.xp).toBe(0);
    expect(server.rooms.get(code)?.status).toBe('encerrada');
  }, 60000);
});
