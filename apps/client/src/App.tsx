import type { ModeId } from '@truco/shared';
import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { AuthModal, RankingModal, SettingsModal, TutorialModal } from './screens/Modals';
import { TableScreen } from './screens/TableScreen';
import { connect, net, useGame } from './store/game';
import { useSettings } from './store/settings';

type ModalName = 'config' | 'conta' | 'ranking' | 'tutorial' | null;

export function App() {
  const room = useGame((s) => s.room);
  const toast = useGame((s) => s.toast);
  const fontScale = useSettings((s) => s.fontScale);
  const [modal, setModal] = useState<ModalName>(null);
  const [inviteCode] = useState(() => new URLSearchParams(location.search).get('sala')?.toUpperCase() ?? '');

  useEffect(() => {
    connect();
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
  }, [fontScale]);

  /** Tutorial: treino de mano a mano contra um bot fácil no modo escolhido. */
  const practice = (modeId: ModeId): void => {
    setModal(null);
    void net.create(
      { modeId, format: '1x1', options: {}, turnSeconds: 60, botLevel: 'facil', fillWithBots: true, isPublic: false, scenario: 'boteco', shuffleCut: false, cutter: 'esquerda', cheats: false, cheatLimit: 3 },
      true,
    );
  };

  const inGame = room !== null && room.status !== 'sala';
  return (
    <div className="relative h-full w-full overflow-hidden">
      {!room && <Home open={setModal} initialCode={inviteCode} />}
      {room && !inGame && <Lobby />}
      {inGame && <TableScreen onSettings={() => setModal('config')} />}
      {!inGame && toast && toast.until > Date.now() && (
        <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl bg-stone-800 px-4 py-2 text-sm shadow-lg">{toast.text}</div>
      )}
      {modal === 'config' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'conta' && <AuthModal onClose={() => setModal(null)} />}
      {modal === 'ranking' && <RankingModal onClose={() => setModal(null)} />}
      {modal === 'tutorial' && <TutorialModal onClose={() => setModal(null)} onPractice={practice} />}
    </div>
  );
}
