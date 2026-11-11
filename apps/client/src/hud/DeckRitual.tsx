import { cardLabel, MAX_CUTS, MAX_SHUFFLES } from '@truco/engine';
import type { Card, PlayerView } from '@truco/shared';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { playSfx } from '../audio/sfx';
import { cardImage } from '../cards/textures';
import { net, useGame } from '../store/game';
import { useSettings } from '../store/settings';

/** Nome curto da carta pelo id, usando o baralho aberto. */
function cardText(view: PlayerView, id: string): string {
  const card = view.deckFaceUp?.find((c) => c.id === id);
  return card ? cardLabel(card, view.config.deck.kind) : id;
}

/** Distância do arrastar (em px) que conta como uma embaralhada. */
const SWIPE = 55;

/** Manda a escolha local um pouco antes do tempo acabar, para o servidor não decidir por cima. */
function useSendBeforeDeadline(send: () => void, enabled: boolean): void {
  const deadline = useGame((s) => s.deadline);
  const latest = useRef(send);
  latest.current = send;
  useEffect(() => {
    if (!deadline || !enabled) return;
    const id = window.setTimeout(() => latest.current(), Math.max(0, deadline - Date.now() - 450));
    return () => window.clearTimeout(id);
  }, [deadline, enabled]);
}

/** Vez do pé: clicar ou arrastar para os lados sobre o baralho embaralha uma vez. */
function ShufflePad({ view }: { view: PlayerView }) {
  const [count, setCount] = useState(0);
  const [sent, setSent] = useState(false);
  // Baralho viciado (malandragem): a carta escolhida no leque vai para o topo ou o fundo.
  const [stack, setStack] = useState<{ cardId: string; position: 'topo' | 'fundo' } | null>(null);
  const canStack = (view.cheatsLeft ?? 0) > 0;
  const counter = useRef(0);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);

  const shuffleOnce = (): void => {
    if (sent || counter.current >= MAX_SHUFFLES) return;
    counter.current += 1;
    setCount(counter.current);
    playSfx('embaralhar');
    useGame.setState({ shuffleAt: Date.now() });
  };
  const send = (): void => {
    if (sent) return;
    setSent(true);
    net.act({
      type: 'EMBARALHAR',
      playerId: view.me,
      times: Math.max(1, counter.current),
      ...(stack ? { stack } : {}),
    });
  };
  useSendBeforeDeadline(send, count > 0 && !sent);

  const down = (e: ReactPointerEvent): void => {
    drag.current = { x: e.clientX, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent): void => {
    const d = drag.current;
    if (!d || Math.abs(e.clientX - d.x) < SWIPE) return;
    d.x = e.clientX;
    d.moved = true;
    shuffleOnce();
  };
  const up = (): void => {
    if (drag.current && !drag.current.moved) shuffleOnce();
    drag.current = null;
  };

  return (
    <>
      {view.deckFaceUp && (
        <OpenDeck
          cards={view.deckFaceUp}
          spanish={view.config.deck.kind === 'espanhol'}
          closed={count > 0}
          picked={stack?.cardId ?? null}
          onPick={
            canStack
              ? (cardId) =>
                  setStack((s) =>
                    s?.cardId === cardId ? null : { cardId, position: s?.position ?? 'fundo' },
                  )
              : undefined
          }
        />
      )}
      {canStack && (
        <div className="pointer-events-auto absolute left-1/2 top-[13.5rem] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs">
          {stack ? (
            <>
              🤫 Baralho viciado: <b>{cardText(view, stack.cardId)}</b> no
              {(['topo', 'fundo'] as const).map((p) => (
                <button
                  key={p}
                  className={`btn-ghost !px-2 !py-0 ${stack.position === p ? '!bg-amber-700' : ''}`}
                  onClick={() => setStack({ ...stack, position: p })}
                >
                  {p}
                </button>
              ))}
              <button className="btn-ghost !px-2 !py-0" onClick={() => setStack(null)}>
                ✕
              </button>
            </>
          ) : (
            <span className="opacity-80">
              🤫 Malandragem: clique numa carta do leque para viciar o baralho
            </span>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[62%] flex-col items-center justify-end gap-3 pb-24">
        <div
          className="pointer-events-auto flex h-40 w-[min(26rem,80vw)] cursor-grab touch-none select-none flex-col items-center justify-center rounded-3xl border-2 border-dashed border-amber-300/70 bg-black/25 text-center active:cursor-grabbing"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => (drag.current = null)}
        >
          <div className="text-lg font-extrabold text-amber-200">Você é o pé: embaralhe!</div>
          <div className="text-sm opacity-80">Clique aqui ou arraste para os lados</div>
          <div className="mt-2 text-3xl font-black">🔀 {count}x</div>
          {count >= MAX_SHUFFLES && (
            <div className="text-xs opacity-70">Máximo de {MAX_SHUFFLES} vezes</div>
          )}
        </div>
        <button
          className="btn pointer-events-auto !px-6 !py-3 text-base font-extrabold"
          disabled={sent}
          onClick={send}
        >
          {count === 0 ? 'Embaralhar uma vez e dar as cartas' : 'Pronto, dar as cartas'}
        </button>
      </div>
    </>
  );
}

/**
 * O baralho recolhido, aberto em leque para o pé conferir antes de embaralhar.
 * Na primeira embaralhada as cartas viram para baixo e se juntam no monte.
 */
function OpenDeck({
  cards,
  spanish,
  closed,
  picked,
  onPick,
}: {
  cards: Card[];
  spanish: boolean;
  closed: boolean;
  picked: string | null;
  onPick?: (cardId: string) => void;
}) {
  const colorblind = useSettings((s) => s.colorblind);
  const half = Math.ceil(cards.length / 2);
  const rows = [cards.slice(0, half), cards.slice(half)];
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-14 flex flex-col items-center gap-1"
      animate={closed ? { opacity: 0, scale: 0.5, y: 160 } : { opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.55, delay: closed ? 0.35 : 0 }}
    >
      {!closed && (
        <div className="rounded-full bg-black/60 px-3 py-0.5 text-xs">
          Baralho recolhido · confira antes de embaralhar
        </div>
      )}
      {rows.map((row, r) => (
        <div key={r} className="flex">
          {row.map((card, i) => (
            <motion.img
              key={card.id}
              src={cardImage(closed ? null : card, spanish, colorblind)}
              alt={closed ? 'carta virada' : card.id}
              draggable={false}
              className={`-ml-[1.6rem] h-[min(11vh,4.6rem)] w-auto rounded shadow first:ml-0 ${onPick && !closed ? 'pointer-events-auto cursor-pointer hover:-translate-y-1' : ''} ${picked === card.id ? '-translate-y-2 ring-2 ring-red-500' : ''}`}
              onClick={onPick && !closed ? () => onPick(card.id) : undefined}
              initial={{ rotateY: 90 }}
              animate={{ rotateY: 0 }}
              transition={{ duration: 0.25, delay: closed ? i * 0.008 : (r * half + i) * 0.012 }}
            />
          ))}
        </div>
      ))}
    </motion.div>
  );
}

/** Vez de cortar: arrastar sobre o baralho escolhe a altura; até três cortes, ou bater na mesa. */
function CutPad({ view }: { view: PlayerView }) {
  const size = view.prep?.deckSize ?? 40;
  const [cuts, setCuts] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  // Olhar o corte (malandragem): ver a carta que ficou embaixo.
  const [peek, setPeek] = useState(false);
  const canPeek = (view.cheatsLeft ?? 0) > 0;
  const deck = useRef<HTMLDivElement>(null);
  const pressing = useRef(false);

  /** Altura (cartas levantadas de cima) no ponto do ponteiro. */
  const heightAt = (clientY: number): number => {
    const box = deck.current?.getBoundingClientRect();
    if (!box) return Math.floor(size / 2);
    const fraction = (clientY - box.top) / box.height;
    return Math.min(size - 1, Math.max(1, Math.round(fraction * size)));
  };
  const send = (list: number[]): void => {
    if (sent) return;
    setSent(true);
    net.act({ type: 'CORTAR', playerId: view.me, cuts: list, ...(peek ? { peek: true } : {}) });
  };
  useSendBeforeDeadline(() => send(cuts), cuts.length > 0 && !sent);

  const full = cuts.length >= MAX_CUTS;
  const marker = hover ?? cuts[cuts.length - 1] ?? null;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="panel pointer-events-auto flex max-w-[92vw] items-stretch gap-4 !p-4">
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs opacity-70">topo</div>
          <div
            ref={deck}
            className={`relative h-[min(46vh,15rem)] w-24 touch-none select-none rounded-md border border-stone-900 shadow-inner ${full ? 'cursor-not-allowed opacity-60' : 'cursor-row-resize'}`}
            style={{
              background: 'repeating-linear-gradient(to bottom, #f3eee0 0 3px, #b9b1a0 3px 4px)',
            }}
            onPointerDown={(e) => {
              if (full || sent) return;
              pressing.current = true;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              setHover(heightAt(e.clientY));
            }}
            onPointerMove={(e) => !full && setHover(heightAt(e.clientY))}
            onPointerLeave={() => !pressing.current && setHover(null)}
            onPointerUp={(e) => {
              if (!pressing.current) return;
              pressing.current = false;
              const height = heightAt(e.clientY);
              setCuts((list) => (list.length >= MAX_CUTS ? list : [...list, height]));
              setHover(null);
              playSfx('carta');
              useGame.setState({ cutAt: Date.now() });
            }}
          >
            {marker !== null && (
              <div
                className="pointer-events-none absolute inset-x-[-10px] h-0.5 bg-red-500"
                style={{ top: `${(marker / size) * 100}%` }}
              >
                <span className="absolute -top-3 left-full ml-1 whitespace-nowrap rounded bg-red-600 px-1 text-[11px] font-bold">
                  {marker}
                </span>
              </div>
            )}
          </div>
          <div className="text-xs opacity-70">fundo</div>
        </div>
        <div className="flex w-56 flex-col gap-2 text-sm">
          <div className="text-lg font-extrabold text-amber-200">Sua vez de cortar</div>
          <p className="opacity-80">
            Arraste sobre o baralho e solte na altura do corte: as cartas acima da linha vão para
            baixo. Até {MAX_CUTS} cortes.
          </p>
          <div className="flex min-h-7 flex-wrap gap-1">
            {cuts.map((c, i) => (
              <span key={i} className="rounded-full bg-amber-800 px-2 py-0.5 text-xs font-bold">
                {i + 1}º: {c} cartas
              </span>
            ))}
            {cuts.length > 0 && !sent && (
              <button
                className="btn-ghost !px-2 !py-0 text-xs"
                onClick={() => setCuts((l) => l.slice(0, -1))}
              >
                desfazer
              </button>
            )}
          </div>
          <button
            className="btn !py-2 font-extrabold"
            disabled={cuts.length === 0 || sent}
            onClick={() => send(cuts)}
          >
            ✂ Cortar {cuts.length > 1 ? `(${cuts.length}x)` : ''}
          </button>
          <button className="btn-ghost !py-2 font-bold" disabled={sent} onClick={() => send([])}>
            👊 Bater na mesa (não cortar)
          </button>
          {canPeek && (
            <label
              className="flex items-center gap-1 text-xs"
              title="Malandragem: ver a carta que ficou embaixo depois do corte"
            >
              <input
                type="checkbox"
                checked={peek}
                disabled={sent}
                onChange={(e) => setPeek(e.target.checked)}
              />{' '}
              🤫 Olhar o corte (ver a carta de baixo)
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

/** Painéis de embaralhar e cortar, só para quem está na vez. */
export function DeckRitual({ view }: { view: PlayerView }) {
  const prep = view.prep;
  if (!prep) return null;
  // A chave reinicia o painel a cada mão.
  if (view.phase === 'embaralhando' && prep.shuffler === view.me)
    return <ShufflePad key={`e${view.handNumber}`} view={view} />;
  if (view.phase === 'cortando' && prep.cutter === view.me)
    return <CutPad key={`c${view.handNumber}`} view={view} />;
  return null;
}
