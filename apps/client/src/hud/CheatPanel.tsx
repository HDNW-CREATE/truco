import { cardLabel, CHEAT_WINDOW_MS } from '@truco/engine';
import type { CheatRequest, PlayerView, RoomState } from '@truco/shared';
import { useState } from 'react';
import { net, seatOf, useGame } from '../store/game';

type Of<K extends CheatRequest['kind']> = Extract<CheatRequest, { kind: K }>;

function nameOf(room: RoomState, playerId: string): string {
  return room.seats[seatOf(playerId)]?.name ?? 'alguém';
}

/** Botão "Malandragem" com o menu do que dá para aprontar agora, mais o gesto à toa para despistar. */
export function CheatControls({ view, room }: { view: PlayerView; room: RoomState }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CheatRequest['kind'] | null>(null);
  if (view.cheatsLeft === null || view.phase === 'fim_de_partida') return null;
  const kind = view.config.deck.kind;
  const label = (id: string): string => {
    const card = view.myCards?.find((c) => c.id === id);
    return card ? cardLabel(card, kind) : id;
  };
  const options = view.cheatOptions;
  const of = <K extends CheatRequest['kind']>(k: K): Of<K>[] =>
    options.filter((o) => o.kind === k) as Of<K>[];
  const go = (cheat: CheatRequest): void => {
    net.act({ type: 'MALANDRAGEM', playerId: view.me, cheat });
    setOpen(false);
    setPending(null);
  };
  const cardChoices = (list: (Of<'manga'> | Of<'usar_manga'> | Of<'passar'>)[]) => (
    <div className="flex flex-wrap gap-1">
      {list.map((o) => (
        <button
          key={`${o.kind}-${o.cardId}`}
          className="btn-ghost !px-2 !py-1 text-sm font-bold"
          onClick={() => go(o)}
        >
          {label(o.cardId)}
        </button>
      ))}
      <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPending(null)}>
        voltar
      </button>
    </div>
  );
  const sleeve = view.mySleeve[0];
  const passTo = of('passar')[0]?.to;

  return (
    <div className="relative flex flex-col items-end gap-1">
      {open && (
        <div className="panel absolute bottom-full right-0 mb-2 w-72 !p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-amber-200">🤫 Malandragem</b>
            <span className="text-xs opacity-70">restam {view.cheatsLeft}</span>
          </div>
          <p className="mb-2 text-xs opacity-70">
            Cada uma faz um gesto que os outros podem flagrar em até 5 s.
          </p>
          {pending === 'manga' && cardChoices(of('manga'))}
          {pending === 'usar_manga' && cardChoices(of('usar_manga'))}
          {pending === 'passar' && cardChoices(of('passar'))}
          {pending === null && (
            <div className="flex flex-col gap-1">
              {of('usar_manga').length > 0 && sleeve && (
                <button className="btn !py-1.5 text-left" onClick={() => setPending('usar_manga')}>
                  🃏 Tirar da manga o {cardLabel(sleeve, kind)} (trocar por…)
                </button>
              )}
              {of('manga').length > 0 && (
                <button className="btn-ghost !py-1.5 text-left" onClick={() => setPending('manga')}>
                  🃏 Carta na manga (guardar uma e puxar outra)
                </button>
              )}
              {of('espiar').map((o) => (
                <button
                  key={o.target}
                  className="btn-ghost !py-1.5 text-left"
                  onClick={() => go(o)}
                >
                  👀 Espiar {nameOf(room, o.target)}
                </button>
              ))}
              {passTo && (
                <button
                  className="btn-ghost !py-1.5 text-left"
                  onClick={() => setPending('passar')}
                >
                  🤝 Passar carta para {nameOf(room, passTo)}
                </button>
              )}
              {of('ponto').length > 0 && (
                <button
                  className="btn-ghost !py-1.5 text-left"
                  onClick={() => go({ kind: 'ponto' })}
                >
                  ✏️ Marcar um tento a mais
                </button>
              )}
              {options.length === 0 && (
                <p className="text-xs opacity-70">Nada para aprontar agora.</p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex gap-1">
        {sleeve && !open && (
          <span className="rounded-full bg-black/60 px-2 py-1 text-xs">
            Na manga: <b>{cardLabel(sleeve, kind)}</b>
          </span>
        )}
        {view.outgoingPass && (
          <span className="rounded-full bg-black/60 px-2 py-1 text-xs">Esperando o parceiro…</span>
        )}
        <button
          className="btn-ghost !px-2 !py-1 text-sm"
          title="Um gesto à toa, sem trapaça, para despistar"
          onClick={net.fakeGesture}
        >
          😶 Gesto à toa
        </button>
        <button
          className={`btn-ghost !px-3 !py-1 text-sm font-bold ${open ? '!bg-amber-700' : ''}`}
          onClick={() => {
            setOpen(!open);
            setPending(null);
          }}
        >
          🤫 Malandragem ({view.cheatsLeft})
        </button>
      </div>
    </div>
  );
}

/** Depois do gesto de um adversário, um botão grande para denunciar por 5 s. */
export function PegaLadrao({ view, room }: { view: PlayerView; room: RoomState }) {
  const gestures = useGame((s) => s.gestures);
  if (view.cheatsLeft === null || view.phase === 'fim_de_partida') return null;
  const now = Date.now();
  const myTeam = view.players.find((p) => p.id === view.me)?.team;
  const recent = Object.entries(gestures)
    .map(([seat, at]) => ({ seat: Number(seat), at }))
    .filter((g) => g.seat % 2 !== myTeam && now - g.at < CHEAT_WINDOW_MS)
    .sort((a, b) => b.at - a.at)[0];
  if (!recent) return null;
  const left = Math.ceil((CHEAT_WINDOW_MS - (now - recent.at)) / 1000);
  return (
    <button
      className="pulso pointer-events-auto absolute right-2 top-14 rounded-xl border-2 border-red-200 bg-red-700 px-4 py-2 text-base font-extrabold text-white shadow-xl hover:bg-red-600"
      onClick={() => {
        net.act({ type: 'DENUNCIAR', playerId: view.me, target: `p${recent.seat}` });
        useGame.setState((s) => ({ gestures: { ...s.gestures, [recent.seat]: 0 } }));
      }}
    >
      🚨 Pega ladrão! ({room.seats[recent.seat]?.name}) · {left}s
    </button>
  );
}

/** O parceiro oferece uma carta por baixo da mesa: aceitar dando uma das minhas, ou recusar. */
export function PassPrompt({ view, room }: { view: PlayerView; room: RoomState }) {
  const offer = view.incomingPass;
  if (!offer) return null;
  const kind = view.config.deck.kind;
  const answer = (cardId: string | null): void =>
    net.act({ type: 'RESPONDER_PASSE', playerId: view.me, cardId });
  return (
    <div className="panel pointer-events-auto absolute left-1/2 top-1/3 w-80 -translate-x-1/2 !p-4 text-center text-sm">
      <div className="mb-1 text-lg font-extrabold text-amber-200">🤝 Por baixo da mesa</div>
      <p className="mb-2">
        {nameOf(room, offer.from)} quer te passar o <b>{cardLabel(offer.card, kind)}</b>. Qual carta
        você dá em troca?
      </p>
      <div className="mb-2 flex flex-wrap justify-center gap-1">
        {(view.myCards ?? []).map((c) => (
          <button key={c.id} className="btn !px-3 !py-1.5 font-bold" onClick={() => answer(c.id)}>
            {cardLabel(c, kind)}
          </button>
        ))}
      </div>
      <button className="btn-ghost !py-1" onClick={() => answer(null)}>
        Recusar
      </button>
    </div>
  );
}
