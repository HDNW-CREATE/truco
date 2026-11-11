// Eventos de socket e tipos de sala compartilhados entre servidor e cliente.
import type { Action, CutterRule, GameEvent, GestureKind, ModeId, PlayerView, SpectatorView, TableFormat } from '../types/index';

/** Opções que a sala escolhe; cada modo usa só as que fazem sentido para ele. */
export interface ModeOptions {
  sujo?: boolean;
  coringa?: boolean;
  manilhaVelha?: boolean;
  flor?: boolean;
  pointsToWin?: number;
  sinais?: boolean;
}

export type BotLevel = 'facil' | 'medio' | 'dificil';
export type Scenario = 'boteco' | 'galpao' | 'bar';
export type HatKind = 'nenhum' | 'palha' | 'bone' | 'gaucho' | 'boina';

/** Aparência do personagem do jogador. */
export interface AvatarConfig {
  skin: string;
  hair: string;
  shirt: string;
  hat: HatKind;
  glasses: boolean;
  mustache: boolean;
}

export interface RoomSettings {
  modeId: ModeId;
  options: ModeOptions;
  format: TableFormat;
  turnSeconds: 15 | 30 | 60;
  botLevel: BotLevel;
  fillWithBots: boolean;
  isPublic: boolean;
  scenario: Scenario;
  /** Antes de cada mão o pé embaralha e um adversário corta. */
  shuffleCut: boolean;
  cutter: CutterRule;
  /** Malandragem liberada: trapaças de brincadeira, a partida não conta para ranking nem ELO. */
  cheats: boolean;
  /** Malandragens por jogador na partida (1 a 10). */
  cheatLimit: number;
}

export interface SeatInfo {
  seat: number;
  name: string;
  kind: 'humano' | 'bot';
  ready: boolean;
  connected: boolean;
  avatar: AvatarConfig;
  /** Id do personagem do elenco quando é bot. */
  persona: string | null;
}

export interface RoomState {
  code: string;
  hostSeat: number | null;
  settings: RoomSettings;
  seats: (SeatInfo | null)[];
  status: 'sala' | 'jogando' | 'encerrada';
  spectators: number;
  /** Lugar de quem recebe esta mensagem (null = espectador). */
  yourSeat: number | null;
}

export interface GameUpdate {
  view: PlayerView | SpectatorView;
  events: GameEvent[];
  /** Momento (ms desde 1970) em que o tempo da jogada acaba; null sem cronômetro. */
  deadline: number | null;
}

export interface ChatMessage {
  seat: number | null;
  name: string;
  text: string;
  kind: 'texto' | 'emote' | 'sistema';
  at: number;
}

export type SignalKind = 'piscar' | 'sobrancelha' | 'labio' | 'lingua' | 'bochecha';

export interface SignalMessage {
  seat: number;
  signal: SignalKind;
  /** true para o parceiro; false quando um adversário "flagrou" o sinal. */
  clear: boolean;
}

/** Gesto rápido de um personagem: pode ser malandragem ou só um gesto à toa. */
export interface GestureMessage {
  seat: number;
  gesture: GestureKind;
}

export interface HeadMessage {
  seat: number;
  yaw: number;
  pitch: number;
}

export interface AchievementMessage {
  key: string;
  title: string;
}

export type Ack<T = object> = (response: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface JoinResult {
  code: string;
  /** Guarde para reconectar no mesmo lugar. */
  session: string;
}

export interface ClientToServerEvents {
  'room:create': (data: { name: string; avatar: AvatarConfig; settings: RoomSettings }, ack: Ack<JoinResult>) => void;
  'room:join': (data: { code: string; name: string; avatar: AvatarConfig; spectator?: boolean }, ack: Ack<JoinResult>) => void;
  'room:quick': (data: { name: string; avatar: AvatarConfig; modeId: ModeId; format: TableFormat }, ack: Ack<JoinResult>) => void;
  'room:sit': (data: { seat: number }) => void;
  'room:ready': (data: { ready: boolean }) => void;
  'room:addBot': (data: { seat: number }) => void;
  'room:removeBot': (data: { seat: number }) => void;
  'room:settings': (settings: RoomSettings) => void;
  'room:start': () => void;
  'room:rematch': () => void;
  'room:leave': () => void;
  'game:action': (action: Action, ack: Ack) => void;
  'chat:send': (data: { text: string; kind?: 'texto' | 'emote' }) => void;
  'signal:send': (data: { signal: SignalKind }) => void;
  'head:rotate': (data: { yaw: number; pitch: number }) => void;
  /** Gesto à toa (sem trapaça), para despistar. */
  'gesture:fake': () => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'game:state': (update: GameUpdate) => void;
  'chat:message': (message: ChatMessage) => void;
  signal: (message: SignalMessage) => void;
  head: (message: HeadMessage) => void;
  gesture: (message: GestureMessage) => void;
  achievement: (message: AchievementMessage) => void;
  'room:closed': (reason: string) => void;
}

/** Dados enviados na conexão: sessão para reconectar e token da conta (opcional). */
export interface SocketAuth {
  session?: string;
  token?: string;
}

// ---------- API REST ----------
export interface AuthResponse {
  token: string;
  name: string;
}

export interface ProfileResponse {
  name: string;
  xp: number;
  level: number;
  avatar: AvatarConfig | null;
  stats: { mode: string; games: number; wins: number; elo: number }[];
  achievements: { key: string; title: string; at: string }[];
}

export interface RankingEntry {
  name: string;
  elo: number;
  games: number;
  wins: number;
}

export const ACHIEVEMENTS: Record<string, string> = {
  primeira_vitoria: 'Primeira vitória',
  dez_vitorias: 'Dez vitórias',
  mao_de_ferro: 'Primeira mão de ferro',
  ganhou_com_flor: 'Ganhou com flor',
  correu_de_nada: 'Correu de nada',
  doze: 'Pediu doze e levou',
};
