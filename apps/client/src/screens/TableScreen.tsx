import { useEffect } from 'react';
import { startMusic, stopMusic } from '../audio/sfx';
import { Hud } from '../hud/Hud';
import { TableScene } from '../scene/TableScene';
import { net, useGame } from '../store/game';

/** A mesa de jogo: cena 3D, interface por cima e o resultado quando a partida acaba. */
export function TableScreen({ onSettings }: { onSettings: () => void }) {
  const room = useGame((s) => s.room);
  const view = useGame((s) => s.view);
  const spectateSeat = useGame((s) => s.spectateSeat);
  const scenario = room?.settings.scenario;

  useEffect(() => {
    if (scenario) startMusic(scenario);
    return stopMusic;
  }, [scenario]);

  if (!room || !view) {
    return <div className="absolute inset-0 flex items-center justify-center text-lg">Distribuindo as cartas...</div>;
  }
  const myTeam = (room.yourSeat ?? spectateSeat) % 2;
  const over = view.phase === 'fim_de_partida';
  const won = view.winner === myTeam;
  const host = room.yourSeat !== null && room.yourSeat === room.hostSeat;

  return (
    <div className="absolute inset-0">
      <TableScene />
      <Hud onLeave={net.leave} onSettings={onSettings} />
      {over && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55">
          <div className="panel text-center">
            <div className="text-4xl font-black text-amber-300">{room.yourSeat === null ? 'Fim de partida' : won ? 'Vitória! 🏆' : 'Derrota'}</div>
            <div className="my-3 text-2xl">
              {view.score[myTeam as 0 | 1]} <span className="opacity-50">x</span> {view.score[myTeam === 0 ? 1 : 0]}
            </div>
            <div className="flex justify-center gap-2">
              {host && room.status === 'encerrada' && <button className="btn" onClick={net.rematch}>Jogar de novo</button>}
              <button className="btn-ghost" onClick={net.leave}>Sair da mesa</button>
            </div>
            {!host && room.yourSeat !== null && <p className="mt-2 text-sm opacity-60">O dono da sala pode começar a revanche.</p>}
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 z-40 hidden items-center justify-center bg-black/85 text-center text-lg portrait:max-md:flex">
        📱 Vire o celular de lado para jogar
      </div>
    </div>
  );
}
