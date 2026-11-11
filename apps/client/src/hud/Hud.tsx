import { cardLabel, manilhaRank } from '@truco/engine';
import type { Action, PlayerView, SignalKind, SpectatorView } from '@truco/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { EMOTES, modeInfo, QUICK_PHRASES } from '../data/modes';
import { anchors } from '../scene/anchors';
import { isPlayerView, net, seatOf, useGame } from '../store/game';
import { CardSpotlight } from './CardSpotlight';
import { CheatControls, PassPrompt, PegaLadrao } from './CheatPanel';
import { DeckRitual } from './DeckRitual';

type View = PlayerView | SpectatorView;

interface Button {
  label: string;
  action: Action;
  tone: string;
  pulse?: boolean;
}

const TONES = {
  truco: 'bg-red-700 hover:bg-red-600 border-red-300',
  envido: 'bg-sky-700 hover:bg-sky-600 border-sky-300',
  flor: 'bg-fuchsia-700 hover:bg-fuchsia-600 border-fuchsia-300',
  sim: 'bg-emerald-700 hover:bg-emerald-600 border-emerald-300',
  nao: 'bg-stone-600 hover:bg-stone-500 border-stone-300',
};

/** Monta os botões só com as ações que o servidor diz serem permitidas agora. */
function buttonsFor(view: PlayerView): Button[] {
  const ladder = view.config.trucoLadder;
  const pendingIndex = view.pendingBet?.kind === 'truco' ? ladder.findIndex((s) => s.name === view.pendingBet?.step) : -1;
  const nextTruco = ladder[(pendingIndex >= 0 ? pendingIndex : view.trucoLevel) + 1]?.name ?? 'Truco';
  const answering = view.pendingBet !== null;
  const buttons: Button[] = [];
  for (const action of view.legalActions) {
    switch (action.type) {
      case 'PEDIR_TRUCO':
        buttons.push({ label: nextTruco.toUpperCase(), action, tone: TONES.truco });
        break;
      case 'CANTAR_ENVIDO':
        buttons.push({ label: action.step.toUpperCase(), action, tone: TONES.envido });
        break;
      case 'CANTAR_FLOR':
        buttons.push({ label: action.step.replaceAll('_', ' ').toUpperCase(), action, tone: TONES.flor, pulse: view.config.flor?.mandatory });
        break;
      case 'RESPONDER':
        buttons.push(
          action.accept
            ? { label: 'QUERO', action, tone: TONES.sim, pulse: answering }
            : { label: view.pendingBet?.kind === 'flor' ? 'ME ACHICO' : 'NÃO QUERO', action, tone: TONES.nao },
        );
        break;
      case 'CORRER':
        buttons.push({ label: 'CORRER', action, tone: TONES.nao });
        break;
      case 'DECIDIR_MAO_DE_ONZE':
        buttons.push(
          action.play
            ? { label: 'JOGAR A MÃO DE ONZE', action, tone: TONES.sim, pulse: true }
            : { label: 'CORRER', action, tone: TONES.nao },
        );
        break;
      default:
        break;
    }
  }
  return buttons;
}

/** Tentos: um risquinho por ponto, agrupados de cinco em cinco. */
function Tally({ points, color }: { points: number; color: string }) {
  return (
    <div className="flex max-w-40 flex-wrap gap-x-1.5 gap-y-0.5">
      {Array.from({ length: Math.ceil(points / 5) }, (_, g) => (
        <div key={g} className="flex gap-0.5">
          {Array.from({ length: Math.min(5, points - g * 5) }, (_, i) => (
            <span key={i} className={`h-3 w-1 rounded-sm ${color}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Scoreboard({ view, myTeam }: { view: View; myTeam: 0 | 1 }) {
  const other = myTeam === 0 ? 1 : 0;
  const kind = view.config.deck.kind;
  const manilha = manilhaRank(view.config, view.turnedCard);
  const half = view.config.envido?.malasBuenas ? view.config.pointsToWin / 2 : null;
  const stage = (points: number): string => (half === null ? '' : points < half ? ' (malas)' : ' (buenas)');
  return (
    <div className="panel pointer-events-auto absolute bottom-14 left-2 w-52 origin-bottom-left !p-3 text-sm [@media(max-height:500px)]:scale-[0.62]">
      <div className="mb-1 text-xs opacity-70">
        {view.config.name} · {view.config.variant} · até {view.config.pointsToWin}
      </div>
      <div className="flex items-center justify-between font-bold">
        <span className="text-emerald-300">Nós{stage(view.score[myTeam])}</span>
        <span className="text-2xl">{view.score[myTeam]}</span>
      </div>
      <Tally points={view.score[myTeam]} color="bg-emerald-300" />
      <div className="mt-1 flex items-center justify-between font-bold">
        <span className="text-rose-300">Eles{stage(view.score[other])}</span>
        <span className="text-2xl">{view.score[other]}</span>
      </div>
      <Tally points={view.score[other]} color="bg-rose-300" />
      <div className="mt-2 border-t border-amber-100/15 pt-2">
        A mão vale <b className="text-amber-300">{view.handValue >= 999 ? 'a partida' : view.handValue}</b>
        {view.turnedCard && (
          <div>
            {view.config.strength.kind === 'muestra' ? 'Muestra' : 'Vira'}: <b>{cardLabel(view.turnedCard, kind)}</b>
            {manilha && <span> · manilha <b>{manilha}</b></span>}
          </div>
        )}
        <div className="mt-1 flex items-center gap-1">
          Rodadas:
          {[0, 1, 2].map((i) => {
            const winner = view.tricks[i]?.winner;
            const color =
              winner === undefined || winner === null ? 'bg-stone-600' : winner === 'empate' ? 'bg-amber-300' : winner === myTeam ? 'bg-emerald-400' : 'bg-rose-400';
            return <span key={i} className={`h-3 w-3 rounded-full ${color}`} />;
          })}
        </div>
      </div>
    </div>
  );
}

/** Cartas da rodada atual em texto, para ler fácil mesmo quando estão de lado na mesa. */
function CurrentTrick({ view }: { view: View }) {
  const trick = view.tricks[view.tricks.length - 1];
  if (!trick || trick.plays.length === 0) return null;
  return (
    <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-1.5">
      {trick.plays.map((play) => (
        <div key={play.playerId} className="rounded-lg bg-black/55 px-2 py-1 text-center text-xs">
          <div className="opacity-70">{view.players.find((p) => p.id === play.playerId)?.name}</div>
          <b>{play.card ? cardLabel(play.card, view.config.deck.kind) : 'coberta'}</b>
        </div>
      ))}
    </div>
  );
}

/** Etiquetas de nome e balões de fala, presos à cabeça de cada personagem na tela. */
function SeatLabels({ view, mySeat, spectator }: { view: View; mySeat: number; spectator: boolean }) {
  const room = useGame((s) => s.room);
  const bubbles = useGame((s) => s.bubbles);
  const elements = useRef(new Map<number, HTMLDivElement>());
  const now = Date.now();

  // A posição muda a cada quadro, então é escrita direto no elemento, sem passar pelo React.
  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      for (const [seat, el] of elements.current) {
        const a = anchors.get(seat);
        el.style.display = a?.visible ? 'flex' : 'none';
        if (a) el.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -100%)`;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);

  const mine = bubbles[mySeat];
  return (
    <>
      {view.players.map((player) => {
        if (!spectator && player.seat === mySeat) return null;
        const info = room?.seats[player.seat];
        const bubble = bubbles[player.seat];
        const isTurn = view.turn === player.id && view.phase === 'jogando';
        const badge = player.seat === view.maoSeat ? 'mão' : player.seat === view.dealerSeat ? 'pé' : null;
        return (
          <div
            key={player.id}
            ref={(el) => {
              if (el) elements.current.set(player.seat, el);
              else elements.current.delete(player.seat);
            }}
            className="absolute left-0 top-0 hidden flex-col items-center gap-1 whitespace-nowrap"
          >
            {bubble && bubble.until > now && (
              <div className="rounded-2xl border-2 border-stone-800 bg-amber-50 px-3 py-1 text-lg font-extrabold text-stone-900 shadow-lg">
                {bubble.text}
              </div>
            )}
            <div
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isTurn ? 'bg-amber-400 text-stone-900' : 'bg-black/60 text-amber-50'} ${
                player.team === mySeat % 2 ? 'ring-1 ring-emerald-400' : 'ring-1 ring-rose-400'
              }`}
            >
              {info?.name ?? player.name}
              {badge && <span className="ml-1 opacity-70">({badge})</span>}
              {info && !info.connected && <span className="ml-1">⚠</span>}
            </div>
          </div>
        );
      })}
      {!spectator && mine && mine.until > now && (
        <div className="absolute bottom-[38%] left-1/2 -translate-x-1/2 rounded-2xl border-2 border-stone-800 bg-amber-50 px-3 py-1 text-lg font-extrabold text-stone-900 shadow-lg">
          Você: {mine.text}
        </div>
      )}
    </>
  );
}

function Timer() {
  const deadline = useGame((s) => s.deadline);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return (
    <div className={`rounded-full px-3 py-1 text-sm font-bold ${left <= 5 ? 'bg-red-600' : 'bg-black/60'}`}>⏱ {left}s</div>
  );
}

const SIGNALS: { id: SignalKind; label: string; hint: string }[] = [
  { id: 'piscar', label: '😉', hint: 'Piscar: ás forte' },
  { id: 'sobrancelha', label: '🤨', hint: 'Sobrancelha: tenho 3' },
  { id: 'labio', label: '😬', hint: 'Morder o lábio: tenho 2' },
  { id: 'lingua', label: '😛', hint: 'Língua: espadão' },
  { id: 'bochecha', label: '😗', hint: 'Bochecha: sete forte' },
];

function Chat() {
  const chat = useGame((s) => s.chat);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = (): void => {
    if (text.trim()) net.chat(text);
    setText('');
  };
  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 w-64 text-sm">
      {open && (
        <div className="panel mb-1 !p-2">
          <div className="flex max-h-36 flex-col-reverse overflow-y-auto">
            <div>
              {chat.map((m, i) => (
                <div key={i} className={m.kind === 'sistema' ? 'italic opacity-60' : ''}>
                  {m.kind !== 'sistema' && <b className="text-amber-300">{m.name}: </b>}
                  {m.text}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {EMOTES.map((e) => (
              <button key={e} className="btn-ghost !px-1.5 !py-0.5" onClick={() => net.chat(e, 'emote')}>
                {e}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {QUICK_PHRASES.map((p) => (
              <button key={p} className="btn-ghost !px-1.5 !py-0.5 text-xs" onClick={() => net.chat(p)}>
                {p}
              </button>
            ))}
          </div>
          <input
            className="field mt-1"
            placeholder="Escreva e aperte Enter"
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
        </div>
      )}
      <button className="btn-ghost" onClick={() => setOpen(!open)}>
        💬 Conversa {chat.length > 0 && !open ? `(${chat.length})` : ''}
      </button>
    </div>
  );
}

export function Hud({ onLeave, onSettings }: { onLeave: () => void; onSettings: () => void }) {
  const view = useGame((s) => s.view);
  const room = useGame((s) => s.room);
  const banner = useGame((s) => s.banner);
  const toast = useGame((s) => s.toast);
  const cover = useGame((s) => s.cover);
  const spectateSeat = useGame((s) => s.spectateSeat);
  const [, tick] = useState(0);

  // Atualiza avisos temporários e liga os atalhos de teclado dos sinais (teclas 1 a 5).
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    const key = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const signal = SIGNALS[Number(e.key) - 1];
      const current = useGame.getState().view;
      if (signal && current?.config.special.sinaisPermitidos) net.signal(signal.id);
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('keydown', key);
    };
  }, []);

  if (!view || !room) return null;
  const player = isPlayerView(view) ? view : null;
  const mySeat = room.yourSeat ?? spectateSeat;
  const myTeam = (mySeat % 2) as 0 | 1;
  const buttons = player ? buttonsFor(player) : [];
  const canCover = player?.legalActions.some((a) => a.type === 'JOGAR_CARTA' && a.faceDown) ?? false;
  const myTurn = player?.legalActions.some((a) => a.type === 'JOGAR_CARTA') ?? false;
  const turnName = view.players.find((p) => p.id === view.turn)?.name;
  const pending = view.pendingBet;
  const now = Date.now();

  const prepName = (id: string | undefined): string => (id ? room.seats[seatOf(id)]?.name ?? 'alguém' : 'alguém');
  let status = '';
  if (view.phase === 'fim_de_partida') status = '';
  else if (view.phase === 'embaralhando') {
    status = view.prep?.shuffler === player?.me ? '' : `${prepName(view.prep?.shuffler)} está embaralhando...`;
  } else if (view.phase === 'cortando') {
    status = view.prep?.cutter === player?.me ? '' : `${prepName(view.prep?.cutter)} vai cortar...`;
  }
  else if (pending && player && buttons.length > 0) {
    status = `${view.players.find((p) => p.id === pending.by)?.name} cantou ${pending.step.replaceAll('_', ' ')}. Responda!`;
  } else if (pending) status = `Esperando resposta para ${pending.step.replaceAll('_', ' ')}...`;
  else if (view.phase === 'decisao_mao_de_onze') status = buttons.length ? 'Mão de onze: veja as cartas do parceiro e decida' : 'O adversário decide a mão de onze...';
  else if (myTurn) status = view.blind ? 'Sua vez: escolha uma carta no escuro' : 'Sua vez: clique em uma carta';
  else if (view.phase === 'jogando') status = `Vez de ${turnName}`;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      <SeatLabels view={view} mySeat={mySeat} spectator={room.yourSeat === null} />
      <Scoreboard view={view} myTeam={myTeam} />
      <CurrentTrick view={view} />
      <CardSpotlight view={view} />
      {player && <DeckRitual view={player} />}
      {player && <PegaLadrao view={player} room={room} />}
      {player && <PassPrompt view={player} room={room} />}

      <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-2">
        <Timer />
        <span className="rounded-full bg-black/60 px-3 py-1 text-xs">Sala {room.code}</span>
        <button className="btn-ghost" onClick={onSettings} title="Configurações">⚙</button>
        <button className="btn-ghost" onClick={onLeave}>Sair</button>
      </div>

      <AnimatePresence>
        {banner && banner.until > now && (
          <motion.div
            key={banner.text}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 top-20 -translate-x-1/2 rounded-2xl border border-amber-300/50 bg-black/75 px-6 py-3 text-xl font-extrabold text-amber-200"
          >
            {banner.text}
          </motion.div>
        )}
      </AnimatePresence>
      {toast && toast.until > now && (
        <div className="absolute left-1/2 top-36 -translate-x-1/2 rounded-xl bg-stone-800/90 px-4 py-2 text-sm">{toast.text}</div>
      )}

      {room.yourSeat === null && (
        <div className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap text-xs">
          <span className="rounded-full bg-black/60 px-3 py-1">👁 Cadeira de:</span>
          {view.players.map((p) => (
            <button
              key={p.id}
              className={`btn-ghost !px-2 !py-1 ${p.seat === spectateSeat ? '!bg-amber-700' : ''}`}
              onClick={() => useGame.setState({ spectateSeat: p.seat })}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {player && (
        <div className="pointer-events-auto absolute bottom-2 right-2 flex max-w-[58vw] flex-col items-end gap-2">
          {status && <div className="rounded-full bg-black/65 px-4 py-1 text-sm font-semibold">{status}</div>}
          <CheatControls view={player} room={room} />
          {view.config.special.sinaisPermitidos && view.phase !== 'fim_de_partida' && (
            <div className="flex gap-1">
              {SIGNALS.map((s, i) => (
                <button key={s.id} className="btn-ghost !px-2 !py-1" title={`${s.hint} (tecla ${i + 1})`} onClick={() => net.signal(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {canCover && (
              <button
                className={`cursor-pointer rounded-xl border-2 px-4 py-3 text-sm font-bold ${cover ? 'border-amber-300 bg-amber-600' : 'border-stone-400 bg-stone-700'}`}
                onClick={() => useGame.setState({ cover: !cover })}
              >
                {cover ? '✓ JOGAR COBERTA' : 'JOGAR COBERTA'}
              </button>
            )}
            {buttons.map((b) => (
              <motion.button
                key={b.label + b.action.type}
                whileTap={{ scale: 0.92 }}
                className={`cursor-pointer rounded-xl border-2 px-5 py-3 text-base font-extrabold text-white shadow-lg [@media(max-height:500px)]:px-3 [@media(max-height:500px)]:py-2 [@media(max-height:500px)]:text-sm ${b.tone} ${b.pulse ? 'pulso' : ''}`}
                onClick={() => net.act(b.action)}
              >
                {b.label}
              </motion.button>
            ))}
          </div>
        </div>
      )}
      <Chat />
      {/* Evita aviso de variável sem uso e documenta o modo atual para leitores de tela. */}
      <span className="sr-only">{modeInfo(view.config.id).name}; vez de {seatOf(view.turn) + 1}</span>
    </div>
  );
}
