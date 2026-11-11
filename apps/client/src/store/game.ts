import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { manilhaRank } from '@truco/engine';
import type {
  Action,
  Card,
  CheatKind,
  GestureKind,
  ChatMessage,
  ClientToServerEvents,
  GameEvent,
  GameUpdate,
  JoinResult,
  ModeId,
  PlayerView,
  RoomSettings,
  RoomState,
  ServerToClientEvents,
  SignalKind,
  SpectatorView,
  TableFormat,
  TeamId,
} from '@truco/shared';
import { playSfx, speak } from '../audio/sfx';
import { useSettings } from './settings';

export type AnimName = 'truco' | 'jogar' | 'sim' | 'nao' | 'triste' | 'festa' | 'pensar' | 'gesto';

export interface Bubble {
  text: string;
  until: number;
}
export interface Anim {
  name: AnimName;
  at: number;
  gesture?: GestureKind;
}

export const CHEAT_LABELS: Record<CheatKind, string> = {
  manga: 'carta na manga',
  usar_manga: 'carta tirada da manga',
  espiar: 'espiada',
  passar: 'carta passada por baixo da mesa',
  viciado: 'baralho viciado',
  olhar_corte: 'olhada no corte',
  ponto: 'tento a mais',
};
export interface SignalShown {
  signal: SignalKind;
  at: number;
}
export interface Head {
  yaw: number;
  pitch: number;
}
/** Carta mostrada grande no canto da tela: a que acabou de ser jogada ou a vira. */
export interface Spotlight {
  key: string;
  /** null = carta coberta. */
  card: Card | null;
  title: string;
  subtitle: string | null;
  until: number;
}

type View = PlayerView | SpectatorView;
export const isPlayerView = (view: View | null): view is PlayerView => view !== null && 'me' in view;
export const seatOf = (playerId: string): number => Number(playerId.slice(1));

interface GameStore {
  connected: boolean;
  room: RoomState | null;
  view: View | null;
  deadline: number | null;
  chat: ChatMessage[];
  bubbles: Record<number, Bubble>;
  anims: Record<number, Anim>;
  signals: Record<number, SignalShown>;
  heads: Record<number, Head>;
  banner: Bubble | null;
  toast: Bubble | null;
  /** Momento do último truco cantado, para tremer a câmera. */
  shakeAt: number;
  /** Lugar de quem falou por último, para a opção de virar a cabeça sozinho. */
  speaker: number | null;
  /** Jogar a próxima carta virada para baixo. */
  cover: boolean;
  /** Espectador: de qual cadeira assistir. */
  spectateSeat: number;
  spotlight: Spotlight | null;
  /** Momento da última embaralhada (para animar o baralho nas mãos do pé). */
  shuffleAt: number;
  /** Momento do último corte e se foi uma batida na mesa. */
  cutAt: number;
  /** Último gesto de cada lugar (para o botão "Pega ladrão!"). */
  gestures: Record<number, number>;
  set: (partial: Partial<GameStore>) => void;
}

export const useGame = create<GameStore>()((set) => ({
  connected: false,
  room: null,
  view: null,
  deadline: null,
  chat: [],
  bubbles: {},
  anims: {},
  signals: {},
  heads: {},
  banner: null,
  toast: null,
  shakeAt: 0,
  speaker: null,
  cover: false,
  spectateSeat: 0,
  spotlight: null,
  shuffleAt: 0,
  cutAt: 0,
  gestures: {},
  set: (partial) => set(partial),
}));

const SESSION_KEY = 'truco.sessao';
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

const toast = (text: string): void => useGame.setState({ toast: { text, until: Date.now() + 3500 } });
const banner = (text: string): void => useGame.setState({ banner: { text, until: Date.now() + 3200 } });

/** De que lado da tela está o lugar, de -1 (esquerda) a 1 (direita), para o som. */
function panOf(seat: number): number {
  const { room, spectateSeat } = useGame.getState();
  const n = room?.seats.length ?? 4;
  const mine = room?.yourSeat ?? spectateSeat;
  return Math.sin((((seat - mine + n) % n) * 2 * Math.PI) / n);
}

function myTeam(view: View): TeamId {
  if (isPlayerView(view)) return view.players.find((p) => p.id === view.me)?.team ?? 0;
  return (useGame.getState().spectateSeat % 2) as TeamId;
}

/** Transforma os eventos do servidor em falas, animações, sons e avisos. */
function handleEvents(events: GameEvent[], view: View): void {
  const now = Date.now();
  const { bubbles, anims } = useGame.getState();
  const nextBubbles = { ...bubbles };
  const nextAnims = { ...anims };
  const patch: Partial<GameStore> = {};
  const us = myTeam(view);
  const side = (team: TeamId): string => (team === us ? 'Nós' : 'Eles');
  const animateTeam = (team: TeamId, name: AnimName): void => {
    for (const p of view.players) if (p.team === team) nextAnims[p.seat] = { name, at: now };
  };
  const mine = useGame.getState().room?.yourSeat ?? null;
  const nameOf = (playerId: string): string => {
    const seat = seatOf(playerId);
    if (seat === mine) return 'Você';
    return useGame.getState().room?.seats[seat]?.name ?? view.players.find((p) => p.id === playerId)?.name ?? 'Alguém';
  };
  const cutDone = events.some((e) => e.type === 'BARALHO_CORTADO');

  for (const e of events) {
    switch (e.type) {
      case 'VEZ_DE_EMBARALHAR':
        patch.cover = false;
        patch.spotlight = null;
        break;
      case 'BARALHO_EMBARALHADO': {
        const seat = seatOf(e.playerId);
        nextBubbles[seat] = { text: `Embaralhei ${e.times}x`, until: now + 1800 };
        patch.shuffleAt = now;
        if (seat !== mine) playSfx('embaralhar', panOf(seat));
        break;
      }
      case 'BARALHO_CORTADO': {
        const seat = seatOf(e.playerId);
        const knock = e.cuts.length === 0;
        nextBubbles[seat] = { text: knock ? 'Bati!' : e.cuts.length === 1 ? 'Cortei' : `Cortei ${e.cuts.length}x`, until: now + 1800 };
        patch.cutAt = now;
        if (knock) {
          patch.shakeAt = now;
          playSfx('soco', panOf(seat));
        } else playSfx('carta', panOf(seat));
        break;
      }
      case 'CARTAS_DISTRIBUIDAS':
        // Com embaralhar e cortar o som da embaralhada já tocou; aqui só as cartas indo para as mãos.
        playSfx(cutDone ? 'carta' : 'embaralhar');
        patch.cover = false;
        if (view.turnedCard) {
          const rank = manilhaRank(view.config, view.turnedCard);
          patch.spotlight = {
            key: `vira-${view.handNumber}`,
            card: view.turnedCard,
            title: view.config.strength.kind === 'muestra' ? 'Muestra' : 'Vira',
            subtitle: rank ? `Manilha: ${rank}` : null,
            until: now + 3200,
          };
        }
        break;
      case 'PEGA_LADRAO': {
        const by = nameOf(e.by);
        const target = nameOf(e.target);
        const lost = side(e.penalty.team);
        banner(
          e.correct
            ? `🚨 Pega ladrão! ${by} pegou ${target}: ${CHEAT_LABELS[e.kind ?? 'ponto']}. ${lost} -${e.penalty.points}`
            : `🚨 ${by} acusou ${target} à toa. ${lost} -${e.penalty.points}`,
        );
        nextBubbles[seatOf(e.by)] = { text: 'Pega ladrão!', until: now + 2200 };
        nextAnims[seatOf(e.by)] = { name: 'truco', at: now };
        nextAnims[seatOf(e.target)] = { name: e.correct ? 'triste' : 'nao', at: now };
        patch.shakeAt = now;
        playSfx('soco');
        break;
      }
      case 'CARTA_JOGADA': {
        const seat = seatOf(e.play.playerId);
        nextAnims[seat] = { name: 'jogar', at: now };
        playSfx('carta', panOf(seat));
        patch.spotlight = {
          key: `jogada-${view.handNumber}-${now}-${seat}`,
          card: e.play.card,
          title: nameOf(e.play.playerId),
          subtitle: e.play.faceDown ? 'jogou coberta' : 'jogou',
          until: now + 2400,
        };
        break;
      }
      case 'FALA': {
        const seat = seatOf(e.playerId);
        nextBubbles[seat] = { text: e.text, until: now + 2800 };
        patch.speaker = seat;
        const anim: AnimName =
          e.kind === 'truco' ? 'truco' : e.kind === 'recusa' ? 'nao' : e.kind === 'corre' ? 'triste' : 'sim';
        nextAnims[seat] = { name: anim, at: now };
        if (e.kind === 'truco') {
          patch.shakeAt = now + 300;
          window.setTimeout(() => playSfx('soco', panOf(seat)), 300);
        }
        speak(e.text, seat);
        break;
      }
      case 'ENVIDO_RESOLVIDO':
        banner(
          `Envido: ${side(e.winner)} +${e.points}${e.values ? ` (${e.values[us]} a ${e.values[us === 0 ? 1 : 0]})` : ''}`,
        );
        playSfx('ponto');
        break;
      case 'FLOR_RESOLVIDA':
        banner(`Flor: ${side(e.winner)} +${e.points}`);
        playSfx('ponto');
        break;
      case 'MAO_DE_ONZE':
        banner(e.team === us ? 'Mão de onze: jogar ou correr?' : 'Mão de onze deles');
        break;
      case 'MAO_DE_FERRO':
        banner('Mão de ferro: todos jogam no escuro!');
        break;
      case 'PICA_PICA': {
        const names = e.duel.map((id) => view.players.find((p) => p.id === id)?.name ?? id);
        banner(`Pica-pica: ${names[0]} x ${names[1]}`);
        break;
      }
      case 'MAO_ENCERRADA':
        if (e.winner === null) banner('Empatou tudo: ninguém pontua');
        else {
          banner(`${side(e.winner)} ${e.winner === us ? 'levamos' : 'levaram'} a mão (+${e.points})`);
          animateTeam(e.winner, 'festa');
          animateTeam(e.winner === 0 ? 1 : 0, 'triste');
          playSfx('ponto');
        }
        break;
      case 'PARTIDA_ENCERRADA':
        animateTeam(e.winner, 'festa');
        playSfx('vitoria');
        break;
      default:
        break;
    }
  }
  // O que eu vi escondido (espiar, olhar o corte) aparece grande no canto por um instante.
  const reveal = isPlayerView(view) ? view.myReveals[0] : undefined;
  if (reveal) {
    patch.spotlight = {
      key: `segredo-${now}`,
      card: reveal.card,
      title: reveal.kind === 'espiar' ? `👀 Carta de ${nameOf(reveal.owner ?? '')}` : '👀 Ficou embaixo do baralho',
      subtitle: null,
      until: now + (reveal.kind === 'espiar' ? 1000 : 2500),
    };
  }
  useGame.setState({ ...patch, bubbles: nextBubbles, anims: nextAnims });
}

/** Abre a conexão (uma só) e liga os ouvintes antes de conectar, para não perder mensagens. */
export function connect(): void {
  if (socket) return;
  const { token } = useSettings.getState();
  socket = io({
    autoConnect: false,
    auth: { token: token ?? undefined, session: sessionStorage.getItem(SESSION_KEY) ?? undefined },
  });
  socket.on('connect', () => useGame.setState({ connected: true }));
  socket.on('disconnect', () => useGame.setState({ connected: false }));
  socket.on('room:state', (room) => {
    const previous = useGame.getState().room;
    useGame.setState({ room, ...(room.status === 'sala' ? { view: null } : {}) });
    if (previous?.code !== room.code) useGame.setState({ chat: [], bubbles: {}, anims: {} });
  });
  socket.on('game:state', (update: GameUpdate) => {
    useGame.setState({ view: update.view, deadline: update.deadline });
    handleEvents(update.events, update.view);
  });
  socket.on('chat:message', (message) => {
    useGame.setState((s) => ({
      chat: [...s.chat.slice(-60), message],
      ...(message.seat !== null && message.kind !== 'sistema'
        ? { bubbles: { ...s.bubbles, [message.seat]: { text: message.text, until: Date.now() + 3000 } } }
        : {}),
    }));
  });
  socket.on('signal', (message) => {
    useGame.setState((s) => ({
      signals: { ...s.signals, [message.seat]: { signal: message.signal, at: Date.now() } },
    }));
    if (!message.clear) {
      const name = useGame.getState().room?.seats[message.seat]?.name ?? 'alguém';
      toast(`Você flagrou um sinal de ${name}!`);
    }
  });
  socket.on('gesture', (message) => {
    const now = Date.now();
    useGame.setState((s) => ({
      anims: { ...s.anims, [message.seat]: { name: 'gesto', at: now, gesture: message.gesture } },
      gestures: { ...s.gestures, [message.seat]: now },
    }));
  });
  socket.on('head', (message) => {
    useGame.setState((s) => ({ heads: { ...s.heads, [message.seat]: { yaw: message.yaw, pitch: message.pitch } } }));
  });
  socket.on('achievement', (message) => toast(`Conquista: ${message.title}`));
  socket.on('room:closed', (reason) => {
    sessionStorage.removeItem(SESSION_KEY);
    useGame.setState({ room: null, view: null });
    toast(reason);
  });
  socket.connect();
}

/** Refaz a conexão (depois de login ou logout) para o servidor conhecer a conta. */
export function reconnect(): void {
  socket?.close();
  socket = null;
  useGame.setState({ room: null, view: null, connected: false });
  connect();
}

function who(): { name: string; avatar: ReturnType<typeof useSettings.getState>['avatar'] } {
  const { name, avatar } = useSettings.getState();
  return { name: name.trim() || 'Convidado', avatar };
}

function joined(resolve: (ok: boolean) => void) {
  return (response: ({ ok: true } & JoinResult) | { ok: false; error: string }): void => {
    if (!response.ok) {
      toast(response.error);
      return resolve(false);
    }
    if (response.session) sessionStorage.setItem(SESSION_KEY, response.session);
    else sessionStorage.removeItem(SESSION_KEY);
    resolve(true);
  };
}

export const net = {
  create: (settings: RoomSettings, autoStart = false): Promise<boolean> =>
    new Promise((resolve) => {
      socket?.emit('room:create', { ...who(), settings }, (response) => {
        joined(resolve)(response);
        if (response.ok && autoStart) socket?.emit('room:start');
      });
    }),
  join: (code: string, spectator = false): Promise<boolean> =>
    new Promise((resolve) => socket?.emit('room:join', { ...who(), code, spectator }, joined(resolve))),
  quick: (modeId: ModeId, format: TableFormat): Promise<boolean> =>
    new Promise((resolve) => socket?.emit('room:quick', { ...who(), modeId, format }, joined(resolve))),
  leave: (): void => {
    socket?.emit('room:leave');
    sessionStorage.removeItem(SESSION_KEY);
    useGame.setState({ room: null, view: null, chat: [], bubbles: {}, anims: {}, banner: null, spotlight: null });
  },
  sit: (seat: number): void => void socket?.emit('room:sit', { seat }),
  ready: (ready: boolean): void => void socket?.emit('room:ready', { ready }),
  addBot: (seat: number): void => void socket?.emit('room:addBot', { seat }),
  removeBot: (seat: number): void => void socket?.emit('room:removeBot', { seat }),
  settings: (settings: RoomSettings): void => void socket?.emit('room:settings', settings),
  start: (): void => void socket?.emit('room:start'),
  rematch: (): void => void socket?.emit('room:rematch'),
  act: (action: Action): void => {
    playSfx('clique');
    socket?.emit('game:action', action, (response) => {
      if (!response.ok) toast('Essa jogada não é permitida agora');
    });
    useGame.setState({ cover: false });
  },
  chat: (text: string, kind: 'texto' | 'emote' = 'texto'): void => void socket?.emit('chat:send', { text, kind }),
  signal: (signal: SignalKind): void => {
    socket?.emit('signal:send', { signal });
    toast('Sinal enviado');
  },
  head: (yaw: number, pitch: number): void => void socket?.emit('head:rotate', { yaw, pitch }),
  /** Gesto à toa, para despistar (só com malandragem liberada). */
  fakeGesture: (): void => {
    socket?.emit('gesture:fake');
    const seat = useGame.getState().room?.yourSeat;
    if (seat !== null && seat !== undefined) {
      const gestures = ['nariz', 'chapeu', 'tosse', 'espreguicar', 'olhar_lado'] as const;
      const gesture = gestures[Math.floor(Math.random() * gestures.length)];
      useGame.setState((s) => ({ anims: { ...s.anims, [seat]: { name: 'gesto', at: Date.now(), gesture } } }));
    }
  },
};
