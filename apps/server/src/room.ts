import { randomBytes } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  ACHIEVEMENTS,
  type Action,
  type AvatarConfig,
  type ChatMessage,
  type ClientToServerEvents,
  type GameEvent,
  type GameUpdate,
  type GameState,
  type GestureKind,
  type Player,
  type RoomSettings,
  type RoomState,
  type SeatInfo,
  type ServerToClientEvents,
  type SignalKind,
  type TeamId,
} from '@truco/shared';
import {
  applyAction,
  botDenounceChance,
  buildMode,
  cardPower,
  CHEAT_WINDOW_MS,
  chooseBotAction,
  chooseBotCheat,
  chooseBotPassResponse,
  GESTURES,
  isCheatAction,
  createGameWithEvents,
  getLegalActions,
  getPlayerView,
  getSpectatorView,
  PERSONAS,
  PLAYERS_PER_FORMAT,
  startNextHand,
} from '@truco/engine';
import type { Db } from './db';
import { saveMatch } from './results';

export type Io = Server<ClientToServerEvents, ServerToClientEvents>;

export interface Timing {
  /** Tempo de "pensamento" dos bots, em ms: mínimo e máximo. */
  botDelay: [number, number];
  /** Pausa entre o fim de uma mão e a próxima. */
  nextHandDelay: number;
  /** Quanto tempo esperar um jogador desconectado antes de o bot assumir. */
  disconnectGrace: number;
  /** Partida rápida: tempo de espera por outros jogadores antes de completar com bots. */
  quickFillDelay: number;
  /** Sala sem ninguém conectado é apagada depois deste tempo. */
  emptyRoomTtl: number;
  /** Tempo para embaralhar e para cortar; se acabar, o jogo faz sozinho. */
  prepTime: number;
  /** Janela para gritar "Pega ladrão!" depois de uma malandragem. */
  cheatWindow: number;
  /** Tempo para o parceiro responder a um passe de carta; depois, conta como recusa. */
  passTimeout: number;
  /** Chance de um bot fazer um gesto à toa a cada jogada (para despistar). */
  botFidget: number;
}

export const DEFAULT_TIMING: Timing = {
  botDelay: [800, 2500],
  nextHandDelay: 3500,
  disconnectGrace: 30000,
  quickFillDelay: 8000,
  emptyRoomTtl: 120000,
  prepTime: 10000,
  cheatWindow: CHEAT_WINDOW_MS,
  passTimeout: 10000,
  botFidget: 0.12,
};

interface Seat {
  seat: number;
  kind: 'humano' | 'bot';
  name: string;
  avatar: AvatarConfig;
  persona: string | null;
  ready: boolean;
  socketId: string | null;
  session: string | null;
  userId: number | null;
  disconnectedAt: number | null;
  earned: Set<string>;
}

export interface Member {
  socketId: string;
  name: string;
  avatar: AvatarConfig;
  userId: number | null;
}

const BAD_WORDS = ['porra', 'caralho', 'merda', 'puta', 'foder', 'fodase', 'buceta', 'cuzao', 'viado', 'arrombado'];

/** Troca palavrões por asteriscos, ignorando acentos e maiúsculas. */
export function filterProfanity(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    const plain = word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return BAD_WORDS.some((bad) => plain.includes(bad)) ? '*'.repeat(word.length) : word;
  });
}

export class Room {
  seats: (Seat | null)[];
  status: RoomState['status'] = 'sala';
  game: GameState | null = null;
  readonly spectators = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private fillTimer: NodeJS.Timeout | null = null;
  private emptyTimer: NodeJS.Timeout | null = null;
  private deadline: number | null = null;
  private hostSeat: number | null = null;
  /** Cronômetros das malandragens (janela de denúncia, passe de carta, denúncias dos bots). */
  private readonly sideTimers = new Set<NodeJS.Timeout>();
  /** Última visão enviada a cada conexão, para não mandar atualização vazia que entregue uma malandragem. */
  private readonly lastSent = new Map<string, string>();
  private seenCheatId = 0;
  private watchedOffer: string | null = null;
  closed = false;

  constructor(
    readonly code: string,
    public settings: RoomSettings,
    private readonly io: Io,
    private readonly timing: Timing,
    private readonly db: Db | null,
    private readonly onClose: (room: Room) => void,
    private readonly log: (message: string, data?: object) => void = () => {},
  ) {
    this.seats = Array.from({ length: PLAYERS_PER_FORMAT[settings.format] }, () => null);
  }

  // ---------- Consultas ----------

  private get channel(): string {
    return `sala:${this.code}`;
  }

  seatOf(socketId: string): Seat | null {
    return this.seats.find((s) => s?.socketId === socketId) ?? null;
  }

  findSession(session: string): Seat | null {
    return this.seats.find((s) => s?.session === session) ?? null;
  }

  hasFreeSeat(): boolean {
    return this.seats.some((s) => s === null);
  }

  private connectedHumans(): Seat[] {
    return this.seats.filter((s): s is Seat => s !== null && s.kind === 'humano' && s.socketId !== null);
  }

  private info(seat: Seat): SeatInfo {
    return {
      seat: seat.seat,
      name: seat.name,
      kind: seat.kind,
      ready: seat.ready,
      connected: seat.kind === 'bot' || seat.socketId !== null,
      avatar: seat.avatar,
      persona: seat.persona,
    };
  }

  private stateFor(yourSeat: number | null): RoomState {
    return {
      code: this.code,
      hostSeat: this.hostSeat,
      settings: this.settings,
      seats: this.seats.map((s) => (s ? this.info(s) : null)),
      status: this.status,
      spectators: this.spectators.size,
      yourSeat,
    };
  }

  // ---------- Envio ----------

  emitRoomState(): void {
    for (const seat of this.connectedHumans()) {
      this.io.to(seat.socketId as string).emit('room:state', this.stateFor(seat.seat));
    }
    for (const socketId of this.spectators.keys()) {
      this.io.to(socketId).emit('room:state', this.stateFor(null));
    }
  }

  /**
   * Manda a cada jogador só a visão dele; espectadores não veem a mão de ninguém.
   * Gestos saem à parte (ver emitGestures). Sem eventos públicos, só recebe quem teve a visão mudada:
   * assim uma malandragem escondida não gera uma atualização vazia que a entregue.
   */
  private broadcastGame(allEvents: GameEvent[]): void {
    const game = this.game;
    if (!game) return;
    const events = allEvents.filter((e) => e.type !== 'GESTO');
    const send = (socketId: string, view: GameUpdate['view']): void => {
      const json = JSON.stringify([view, this.deadline]);
      if (events.length === 0 && this.lastSent.get(socketId) === json) return;
      this.lastSent.set(socketId, json);
      this.io.to(socketId).emit('game:state', { view, events, deadline: this.deadline });
    };
    for (const seat of this.connectedHumans()) send(seat.socketId as string, getPlayerView(game, `p${seat.seat}`));
    if (this.spectators.size > 0) {
      const view = getSpectatorView(game);
      for (const socketId of this.spectators.keys()) send(socketId, view);
    }
  }

  /** Gesto de um personagem para todos os outros: malandragem e gesto à toa saem iguais. */
  private gesture(seat: number, gesture: GestureKind): void {
    const socketId = this.seats[seat]?.socketId;
    const target = socketId ? this.io.to(this.channel).except(socketId) : this.io.to(this.channel);
    target.emit('gesture', { seat, gesture });
    this.botsMaybeDenounce(seat);
  }

  private emitGestures(events: GameEvent[]): void {
    for (const e of events) if (e.type === 'GESTO') this.gesture(Number(e.playerId.slice(1)), e.gesture);
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.sideTimers.delete(timer);
      if (!this.closed && this.game && this.status === 'jogando') fn();
    }, ms);
    this.sideTimers.add(timer);
  }

  /** Bots adversários de quem gesticulou podem gritar "Pega ladrão!" (no máximo um por gesto). */
  private botsMaybeDenounce(seat: number, random: () => number = Math.random): void {
    if (!this.game?.options.cheats) return;
    const rivals = this.seats.filter((s): s is Seat => s?.kind === 'bot' && s.seat % 2 !== seat % 2);
    const caller = rivals.find((s) => random() < botDenounceChance(PERSONAS.find((p) => p.id === s.persona)?.personality));
    if (!caller) return;
    const wait = Math.min(this.timing.cheatWindow - 300, 1200 + random() * 2300);
    this.later(Math.max(50, wait), () => {
      this.apply(caller, { type: 'DENUNCIAR', playerId: `p${caller.seat}`, target: `p${seat}` });
    });
  }

  /** Arma a janela de denúncia das malandragens novas e cuida do passe de carta pendente. */
  private watchCheats(state: GameState): void {
    for (const record of state.cheats.records) {
      if (record.id <= this.seenCheatId) continue;
      this.seenCheatId = record.id;
      if (!record.open) continue;
      this.later(this.timing.cheatWindow, () => {
        const seat = this.seats[Number(record.by.slice(1))];
        if (seat) this.apply(seat, { type: 'FECHAR_MALANDRAGEM', playerId: record.by, id: record.id });
      });
    }
    const offer = state.hand.passOffer;
    if (!offer) {
      this.watchedOffer = null;
      return;
    }
    const key = `${state.handNumber}|${offer.from}|${offer.cardId}`;
    if (key === this.watchedOffer) return;
    this.watchedOffer = key;
    const partner = this.seats[Number(offer.to.slice(1))];
    if (!partner) return;
    const isBot = partner.kind === 'bot' || partner.socketId === null;
    const [min, max] = this.timing.botDelay;
    this.later(isBot ? min + Math.random() * (max - min) : this.timing.passTimeout, () => {
      const game = this.game;
      if (!game || game.hand.passOffer?.from !== offer.from || game.hand.passOffer.cardId !== offer.cardId) return;
      const cardId = isBot ? chooseBotPassResponse(getPlayerView(game, offer.to)) : null;
      this.apply(partner, { type: 'RESPONDER_PASSE', playerId: offer.to, cardId });
    });
  }

  /** Gesto à toa pedido por um jogador, para despistar. */
  fakeGesture(socketId: string): void {
    const seat = this.seatOf(socketId);
    if (!seat || !this.game?.options.cheats || this.status !== 'jogando') return;
    this.gesture(seat.seat, GESTURES[Math.floor(Math.random() * GESTURES.length)] as GestureKind);
  }

  private system(text: string): void {
    const message: ChatMessage = { seat: null, name: 'Mesa', text, kind: 'sistema', at: Date.now() };
    this.io.to(this.channel).emit('chat:message', message);
  }

  // ---------- Entrada e saída ----------

  private join(socketId: string): void {
    this.io.sockets.sockets.get(socketId)?.join(this.channel);
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  /** Senta o jogador no primeiro lugar livre. Devolve a sessão para reconexão, ou null se lotou. */
  addPlayer(member: Member): string | null {
    if (this.status !== 'sala') return null;
    const index = this.seats.findIndex((s) => s === null);
    if (index < 0) return null;
    const session = randomBytes(18).toString('base64url');
    this.seats[index] = {
      seat: index,
      kind: 'humano',
      name: member.name,
      avatar: member.avatar,
      persona: null,
      ready: false,
      socketId: member.socketId,
      session,
      userId: member.userId,
      disconnectedAt: null,
      earned: new Set(),
    };
    if (this.hostSeat === null) this.hostSeat = index;
    this.join(member.socketId);
    this.emitRoomState();
    this.system(`${member.name} entrou na mesa.`);
    return session;
  }

  addSpectator(member: Member): void {
    this.spectators.set(member.socketId, member.name);
    this.join(member.socketId);
    this.emitRoomState();
    if (this.game) {
      this.io.to(member.socketId).emit('game:state', {
        view: getSpectatorView(this.game),
        events: [],
        deadline: this.deadline,
      });
    }
  }

  /** Jogador que caiu volta para o mesmo lugar. */
  reconnect(seat: Seat, socketId: string): void {
    seat.socketId = socketId;
    seat.disconnectedAt = null;
    this.join(socketId);
    this.emitRoomState();
    if (this.game) {
      this.io.to(socketId).emit('game:state', {
        view: getPlayerView(this.game, `p${seat.seat}`),
        events: [],
        deadline: this.deadline,
      });
      this.schedule();
    }
  }

  /** Queda de conexão: o lugar fica guardado e o bot assume depois do prazo. */
  disconnect(socketId: string): void {
    if (this.spectators.delete(socketId)) {
      this.emitRoomState();
      this.checkEmpty();
      return;
    }
    const seat = this.seatOf(socketId);
    if (!seat) return;
    if (this.status === 'sala') {
      this.removeSeat(seat);
      return;
    }
    seat.socketId = null;
    seat.disconnectedAt = Date.now();
    this.emitRoomState();
    this.schedule();
    this.checkEmpty();
  }

  /** Saída voluntária: na sala o lugar fica livre; durante o jogo um bot assume de vez. */
  leave(socketId: string): void {
    this.io.sockets.sockets.get(socketId)?.leave(this.channel);
    if (this.spectators.delete(socketId)) {
      this.emitRoomState();
      this.checkEmpty();
      return;
    }
    const seat = this.seatOf(socketId);
    if (!seat) return;
    if (this.status === 'jogando') {
      seat.kind = 'bot';
      seat.socketId = null;
      seat.session = null;
      seat.userId = null;
      seat.name = `${seat.name} (bot)`;
      if (this.hostSeat === seat.seat) this.pickHost();
      this.emitRoomState();
      this.schedule();
      this.checkEmpty();
      return;
    }
    this.removeSeat(seat);
  }

  private removeSeat(seat: Seat): void {
    this.seats[seat.seat] = null;
    if (this.hostSeat === seat.seat) this.pickHost();
    this.system(`${seat.name} saiu da mesa.`);
    this.emitRoomState();
    this.checkEmpty();
  }

  private pickHost(): void {
    this.hostSeat = this.connectedHumans()[0]?.seat ?? null;
  }

  private checkEmpty(): void {
    if (this.connectedHumans().length > 0 || this.spectators.size > 0) return;
    const waiting = this.seats.some((s) => s?.kind === 'humano' && s.session);
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    if (!waiting || this.status !== 'jogando') return this.close('Sala vazia');
    this.emptyTimer = setTimeout(() => this.close('Sala vazia'), this.timing.emptyRoomTtl);
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of [this.timer, this.fillTimer, this.emptyTimer, ...this.sideTimers]) if (t) clearTimeout(t);
    this.sideTimers.clear();
    this.io.to(this.channel).emit('room:closed', reason);
    this.io.in(this.channel).socketsLeave(this.channel);
    this.onClose(this);
  }

  // ---------- Sala de espera ----------

  private isHost(socketId: string): boolean {
    const seat = this.seatOf(socketId);
    return seat !== null && seat.seat === this.hostSeat;
  }

  sit(socketId: string, index: number): void {
    const seat = this.seatOf(socketId);
    if (!seat || this.status !== 'sala' || this.seats[index] !== null || index >= this.seats.length) return;
    this.seats[seat.seat] = null;
    if (this.hostSeat === seat.seat) this.hostSeat = index;
    seat.seat = index;
    this.seats[index] = seat;
    this.emitRoomState();
  }

  setReady(socketId: string, ready: boolean): void {
    const seat = this.seatOf(socketId);
    if (!seat || this.status !== 'sala') return;
    seat.ready = ready;
    this.emitRoomState();
  }

  private makeBot(index: number): Seat {
    const used = new Set(this.seats.map((s) => s?.persona));
    const persona = PERSONAS.find((p) => !used.has(p.id)) ?? PERSONAS[index % PERSONAS.length];
    if (!persona) throw new Error('Elenco vazio');
    return {
      seat: index,
      kind: 'bot',
      name: persona.name,
      avatar: persona.avatar,
      persona: persona.id,
      ready: true,
      socketId: null,
      session: null,
      userId: null,
      disconnectedAt: null,
      earned: new Set(),
    };
  }

  addBot(socketId: string, index: number): void {
    if (!this.isHost(socketId) || this.status !== 'sala') return;
    if (index < 0 || index >= this.seats.length || this.seats[index] !== null) return;
    this.seats[index] = this.makeBot(index);
    this.emitRoomState();
  }

  removeBot(socketId: string, index: number): void {
    if (!this.isHost(socketId) || this.status !== 'sala') return;
    if (this.seats[index]?.kind !== 'bot') return;
    this.seats[index] = null;
    this.emitRoomState();
  }

  updateSettings(socketId: string, settings: RoomSettings): void {
    if (!this.isHost(socketId) || this.status !== 'sala') return;
    const size = PLAYERS_PER_FORMAT[settings.format];
    if (!size) return;
    if (size !== this.seats.length) {
      // Mudou o tamanho da mesa: os humanos ocupam os primeiros lugares e os bots saem.
      const humans = this.seats.filter((s): s is Seat => s?.kind === 'humano');
      if (humans.length > size) return;
      this.seats = Array.from({ length: size }, (_, i) => {
        const seat = humans[i] ?? null;
        if (seat) {
          if (this.hostSeat === seat.seat) this.hostSeat = i;
          seat.seat = i;
        }
        return seat;
      });
    }
    this.settings = settings;
    this.emitRoomState();
  }

  /** Partida rápida: completa com bots e começa sozinha depois de um tempo. */
  scheduleQuickStart(): void {
    if (this.fillTimer) return;
    this.fillTimer = setTimeout(() => this.startGame(), this.timing.quickFillDelay);
  }

  start(socketId: string): void {
    if (this.isHost(socketId)) this.startGame();
  }

  rematch(socketId: string): void {
    if (!this.isHost(socketId) || this.status !== 'encerrada') return;
    this.status = 'sala';
    this.game = null;
    for (const seat of this.seats) {
      if (seat?.kind === 'humano') seat.ready = false;
    }
    this.emitRoomState();
  }

  // ---------- Partida ----------

  private startGame(): void {
    if (this.status !== 'sala' || this.closed) return;
    if (this.fillTimer) clearTimeout(this.fillTimer);
    this.fillTimer = null;
    if (!this.seats.some((s) => s?.kind === 'humano')) return;
    if (this.hasFreeSeat()) {
      if (!this.settings.fillWithBots) return;
      // Um de cada vez, para cada bot receber um personagem diferente do elenco.
      for (let i = 0; i < this.seats.length; i++) this.seats[i] ??= this.makeBot(i);
    }
    const players: Player[] = (this.seats as Seat[]).map((s) => ({
      id: `p${s.seat}`,
      name: s.name,
      seat: s.seat,
      team: (s.seat % 2) as TeamId,
      isBot: s.kind === 'bot',
    }));
    for (const s of this.seats) s?.earned.clear();
    const config = buildMode(this.settings.modeId, this.settings.options);
    const created = createGameWithEvents(config, players, randomBytes(4).readUInt32LE() % 2147483647, {
      shuffleAndCut: this.settings.shuffleCut,
      cutter: this.settings.cutter,
      cheats: this.settings.cheats,
      cheatLimit: this.settings.cheatLimit,
    });
    this.seenCheatId = 0;
    this.watchedOffer = null;
    this.lastSent.clear();
    this.game = created.state;
    this.status = 'jogando';
    this.log('partida iniciada', { sala: this.code, modo: config.id, seed: this.game.seed });
    this.emitRoomState();
    this.schedule();
    this.broadcastGame(created.events);
  }

  /** Ação vinda de um jogador humano. Devolve a mensagem de erro, ou null se deu certo. */
  handleAction(socketId: string, action: Action): string | null {
    const seat = this.seatOf(socketId);
    if (!seat || !this.game || this.status !== 'jogando') return 'Você não está jogando';
    // Fechar a janela de denúncia é coisa só do servidor.
    if (action?.type === 'FECHAR_MALANDRAGEM') return 'Ação não permitida';
    return this.apply(seat, { ...action, playerId: `p${seat.seat}` });
  }

  private apply(seat: Seat, action: Action): string | null {
    const before = this.game;
    if (!before) return 'Sem partida';
    try {
      this.trackBefore(seat, before, action);
      const result = applyAction(before, action);
      this.game = result.state;
      this.trackEvents(result.events, result.state);
      this.watchCheats(result.state);
      // Malandragem, denúncia e passe não mudam de quem é a vez: o cronômetro continua o mesmo.
      if (!isCheatAction(action)) this.schedule();
      this.broadcastGame(result.events);
      this.emitGestures(result.events);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Ação inválida';
    }
  }

  private trackBefore(seat: Seat, state: GameState, action: Action): void {
    if (action.type !== 'CORRER') return;
    const cards = state.hand.hands[`p${seat.seat}`] ?? [];
    if (cards.some((c) => cardPower(state.config, state.hand.turnedCard, c) > 0.9)) {
      seat.earned.add('correu_de_nada');
    }
  }

  private trackEvents(events: GameEvent[], state: GameState): void {
    const award = (team: TeamId | null, key: string): void => {
      for (const s of this.seats) {
        if (s && (team === null || s.seat % 2 === team)) s.earned.add(key);
      }
    };
    for (const e of events) {
      if (e.type === 'MAO_DE_FERRO') award(null, 'mao_de_ferro');
      if (e.type === 'FLOR_RESOLVIDA') award(e.winner, 'ganhou_com_flor');
      if (e.type === 'MAO_ENCERRADA' && e.winner !== null && state.hand.trucoLevel === 3) {
        award(e.winner, 'doze');
      }
    }
  }

  /** Decide quem age agora e arma o cronômetro: bot depois de "pensar", humano até o tempo acabar. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
    const game = this.game;
    if (!game || this.status !== 'jogando' || this.closed) return;

    if (game.phase === 'fim_de_partida') {
      void this.finish();
      return;
    }
    if (game.phase === 'fim_da_mao') {
      this.timer = setTimeout(() => {
        if (!this.game) return;
        const next = startNextHand(this.game);
        this.game = next.state;
        this.trackEvents(next.events, next.state);
        this.schedule();
        this.broadcastGame(next.events);
      }, this.timing.nextHandDelay);
      return;
    }

    const actors = (this.seats as Seat[]).filter(
      (s) => getLegalActions(game, `p${s.seat}`).length > 0,
    );
    const first = actors[0];
    if (!first) return;
    const now = Date.now();
    const graceLeft = (s: Seat): number =>
      s.disconnectedAt === null ? Infinity : s.disconnectedAt + this.timing.disconnectGrace - now;
    const humans = actors.filter((s) => s.kind === 'humano' && graceLeft(s) > 0);

    if (humans.length === 0) {
      const [min, max] = this.timing.botDelay;
      this.timer = setTimeout(() => this.autoPlay(first), min + Math.random() * (max - min));
      return;
    }
    const preparing = game.phase === 'embaralhando' || game.phase === 'cortando';
    const turn = preparing ? this.timing.prepTime : this.settings.turnSeconds * 1000;
    const wait = Math.min(turn, Math.max(...humans.map(graceLeft)));
    this.deadline = now + turn;
    this.timer = setTimeout(() => this.autoPlay(humans[0] as Seat), wait);
  }

  /** O bot joga: pelo próprio lugar, ou no lugar de um humano que caiu ou deixou o tempo acabar. */
  private autoPlay(seat: Seat): void {
    const game = this.game;
    if (!game) return;
    let view = getPlayerView(game, `p${seat.seat}`);
    if (view.legalActions.length === 0) return this.schedule();
    const persona = PERSONAS.find((p) => p.id === seat.persona);
    const isBot = seat.kind === 'bot';
    if (isBot && game.options.cheats) {
      // Às vezes apronta uma antes de jogar; às vezes só coça o nariz.
      const trick = chooseBotCheat(view, { level: this.settings.botLevel, personality: persona?.personality });
      if (trick) {
        this.apply(seat, { type: 'MALANDRAGEM', playerId: `p${seat.seat}`, cheat: trick });
        if (!this.game) return;
        view = getPlayerView(this.game, `p${seat.seat}`);
        if (view.legalActions.length === 0) return this.schedule();
      } else if (Math.random() < this.timing.botFidget) {
        this.gesture(seat.seat, GESTURES[Math.floor(Math.random() * GESTURES.length)] as GestureKind);
      }
    }
    const action = chooseBotAction(view, {
      level: isBot ? this.settings.botLevel : 'medio',
      personality: persona?.personality,
      cheat: isBot,
    });
    const error = this.apply(seat, action);
    if (error) this.log('bot errou', { sala: this.code, erro: error });
  }

  private async finish(): Promise<void> {
    const game = this.game;
    if (!game) return;
    this.status = 'encerrada';
    this.log('partida encerrada', { sala: this.code, placar: game.score.join('x') });
    this.emitRoomState();
    if (!this.db) return;
    try {
      const players = (this.seats as Seat[]).map((s) => ({
        seat: s.seat,
        team: (s.seat % 2) as TeamId,
        name: s.name,
        userId: s.userId,
        earned: s.earned,
      }));
      const results = await saveMatch(this.db, this.settings, game, players, { ranked: !game.options.cheats });
      for (const result of results) {
        const seat = this.seats.find((s) => s?.userId === result.userId);
        if (!seat?.socketId) continue;
        for (const key of result.newAchievements) {
          this.io.to(seat.socketId).emit('achievement', { key, title: ACHIEVEMENTS[key] ?? key });
        }
      }
    } catch (error) {
      this.log('erro ao salvar partida', { erro: String(error) });
    }
  }

  // ---------- Conversa, sinais e olhar ----------

  chat(socketId: string, text: string, kind: 'texto' | 'emote'): void {
    const seat = this.seatOf(socketId);
    const name = seat?.name ?? this.spectators.get(socketId);
    const clean = filterProfanity(text.trim().slice(0, 140));
    if (!name || !clean) return;
    this.io.to(this.channel).emit('chat:message', {
      seat: seat?.seat ?? null,
      name,
      text: clean,
      kind,
      at: Date.now(),
    });
  }

  /** O parceiro sempre vê o sinal; cada adversário tem 25% de chance de flagrar. */
  signal(socketId: string, signal: SignalKind, random: () => number = Math.random): void {
    const seat = this.seatOf(socketId);
    if (!seat || !this.game?.config.special.sinaisPermitidos) return;
    for (const other of this.connectedHumans()) {
      if (other.seat === seat.seat) continue;
      const partner = other.seat % 2 === seat.seat % 2;
      if (partner || random() < 0.25) {
        this.io.to(other.socketId as string).emit('signal', { seat: seat.seat, signal, clear: partner });
      }
    }
  }

  head(socketId: string, yaw: number, pitch: number): void {
    const seat = this.seatOf(socketId);
    if (!seat || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.io.to(this.channel).except(socketId).volatile.emit('head', { seat: seat.seat, yaw, pitch });
  }
}
