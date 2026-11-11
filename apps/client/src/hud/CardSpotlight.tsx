import { cardLabel, manilhaRank } from '@truco/engine';
import type { PlayerView, SpectatorView } from '@truco/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { cardImage } from '../cards/textures';
import { useGame } from '../store/game';
import { useSettings } from '../store/settings';

type View = PlayerView | SpectatorView;

/**
 * Canto superior esquerdo: a carta que acabou de ser jogada aparece grande, com o nome de quem jogou.
 * No começo da mão a vira aparece grande e depois fica pequena ali, para consulta.
 */
export function CardSpotlight({ view }: { view: View }) {
  const spotlight = useGame((s) => s.spotlight);
  const colorblind = useSettings((s) => s.colorblind);
  const spanish = view.config.deck.kind === 'espanhol';
  const kind = view.config.deck.kind;
  const active = spotlight && spotlight.until > Date.now() ? spotlight : null;
  const turnedName = view.config.strength.kind === 'muestra' ? 'Muestra' : 'Vira';
  const manilha = manilhaRank(view.config, view.turnedCard);

  return (
    <div className="pointer-events-none absolute left-2 top-2">
      <AnimatePresence mode="wait">
        {active ? (
          <motion.div
            key={active.key}
            initial={{ opacity: 0, x: -60, scale: 0.6, rotate: -10 }}
            animate={{ opacity: 1, x: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="flex flex-col items-center gap-1.5"
          >
            <img
              src={cardImage(active.card, spanish, colorblind)}
              alt={`${active.title}: ${active.card ? cardLabel(active.card, kind) : 'carta coberta'}`}
              className="h-[min(44vh,16rem)] w-auto rounded-xl shadow-2xl ring-2 ring-amber-300/80"
              draggable={false}
            />
            <div className="max-w-[12rem] truncate rounded-full bg-black/75 px-3 py-0.5 text-center text-sm font-bold text-amber-100">
              {active.title}
              {active.subtitle && <span className="ml-1 font-normal opacity-80">{active.subtitle}</span>}
            </div>
          </motion.div>
        ) : view.turnedCard ? (
          <motion.div
            key={`mini-${view.handNumber}`}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-0.5"
          >
            <img
              src={cardImage(view.turnedCard, spanish, colorblind)}
              alt={`${turnedName}: ${cardLabel(view.turnedCard, kind)}`}
              className="h-[min(20vh,6.5rem)] w-auto rounded-lg shadow-lg ring-1 ring-amber-200/50"
              draggable={false}
            />
            <div className="rounded-full bg-black/65 px-2 text-[11px]">
              {turnedName}
              {manilha && <> · manilha <b>{manilha}</b></>}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
