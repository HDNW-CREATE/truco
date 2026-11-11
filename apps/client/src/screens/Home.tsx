import { Canvas, useFrame } from '@react-three/fiber';
import type { BotLevel, ModeId, RoomSettings, Scenario, TableFormat } from '@truco/shared';
import { useRef, useState } from 'react';
import type { Group } from 'three';
import { Character } from '../characters/Character';
import { FORMATS, MODES } from '../data/modes';
import { net, useGame } from '../store/game';
import { useSettings } from '../store/settings';
import { AvatarEditor } from './Modals';

function Preview() {
  const avatar = useSettings((s) => s.avatar);
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = Math.sin(clock.elapsedTime * 0.6) * 0.5;
  });
  return (
    <group ref={group} position={[0, -0.95, 0]}>
      <Character avatar={avatar} cardCount={3} />
    </group>
  );
}

interface Props {
  open: (modal: 'config' | 'conta' | 'ranking' | 'tutorial') => void;
  initialCode: string;
}

/** Tela inicial: nome, personagem, escolha do modo e formas de entrar numa mesa. */
export function Home({ open, initialCode }: Props) {
  const settings = useSettings();
  const connected = useGame((s) => s.connected);
  const [modeId, setModeId] = useState<ModeId>('paulista');
  const [format, setFormat] = useState<TableFormat>('2x2');
  const [botLevel, setBotLevel] = useState<BotLevel>('medio');
  const [scenario, setScenario] = useState<Scenario>('boteco');
  const [sujo, setSujo] = useState(false);
  const [coringa, setCoringa] = useState(false);
  const [manilhaVelha, setManilhaVelha] = useState(false);
  const [flor, setFlor] = useState(true);
  const [shuffleCut, setShuffleCut] = useState(false);
  const [cheats, setCheats] = useState(false);
  const [code, setCode] = useState(initialCode);
  const brazilian = modeId === 'paulista';
  const hasFlor = modeId === 'gauderio' || modeId === 'espanhol';

  const roomSettings = (isPublic: boolean): RoomSettings => ({
    modeId,
    format,
    options: { sujo, coringa, manilhaVelha, ...(hasFlor ? { flor } : {}) },
    turnSeconds: 30,
    botLevel,
    fillWithBots: true,
    isPublic,
    scenario,
    shuffleCut,
    cutter: 'esquerda',
    cheats,
    cheatLimit: 3,
  });

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-stone-900 to-amber-950 p-3">
      <div className="mx-auto max-w-5xl">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-black tracking-tight text-amber-300">🃏 Truco na Mesa 3D</h1>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => open('tutorial')}>Como jogar</button>
            <button className="btn-ghost" onClick={() => open('ranking')}>Ranking</button>
            <button className="btn-ghost" onClick={() => open('conta')}>{settings.account ? `👤 ${settings.account}` : 'Entrar'}</button>
            <button className="btn-ghost" onClick={() => open('config')}>⚙</button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-[280px_1fr]">
          <section className="panel">
            <div className="h-52 overflow-hidden rounded-xl bg-black/30">
              <Canvas camera={{ fov: 35, position: [0, 0.15, 2.1] }}>
                <ambientLight intensity={0.9} />
                <directionalLight position={[2, 3, 3]} intensity={1.6} />
                <Preview />
              </Canvas>
            </div>
            <input
              className="field my-2"
              placeholder="Seu nome na mesa"
              maxLength={16}
              value={settings.name}
              disabled={settings.account !== null}
              onChange={(e) => settings.set({ name: e.target.value })}
            />
            <AvatarEditor />
          </section>

          <section className="panel">
            <h2 className="mb-2 font-bold">Modo de jogo</h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={`cursor-pointer rounded-xl border p-2 text-left transition ${m.id === modeId ? 'border-amber-400 bg-amber-800/60' : 'border-amber-100/15 bg-black/25 hover:bg-black/40'}`}
                  onClick={() => setModeId(m.id)}
                >
                  <div className="font-bold">{m.name}</div>
                  <div className="text-xs opacity-70">{m.short}</div>
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <div className="flex gap-1">
                {FORMATS.map((f) => (
                  <button key={f.id} className={`btn-ghost !py-1 ${f.id === format ? '!bg-amber-700' : ''}`} onClick={() => setFormat(f.id)}>
                    {f.name} ({f.id})
                  </button>
                ))}
              </div>
              {brazilian && (
                <>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={sujo} onChange={(e) => setSujo(e.target.checked)} /> Baralho sujo</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={coringa} onChange={(e) => setCoringa(e.target.checked)} /> Com coringa</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={manilhaVelha} onChange={(e) => setManilhaVelha(e.target.checked)} /> Manilha velha</label>
                </>
              )}
              {hasFlor && <label className="flex items-center gap-1"><input type="checkbox" checked={flor} onChange={(e) => setFlor(e.target.checked)} /> Com flor</label>}
              <label className="flex items-center gap-1" title="Antes de cada mão o pé embaralha e um adversário corta"><input type="checkbox" checked={shuffleCut} onChange={(e) => setShuffleCut(e.target.checked)} /> Embaralhar e cortar</label>
              <label className="flex items-center gap-1" title="Trapaças de brincadeira: 3 por jogador. A partida não conta para o ranking."><input type="checkbox" checked={cheats} onChange={(e) => setCheats(e.target.checked)} /> 🤫 Malandragem liberada</label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">Bots:
                <select className="field !w-28 !py-1" value={botLevel} onChange={(e) => setBotLevel(e.target.value as BotLevel)}>
                  <option value="facil">Fáceis</option>
                  <option value="medio">Médios</option>
                  <option value="dificil">Difíceis</option>
                </select>
              </label>
              <label className="flex items-center gap-1">Cenário:
                <select className="field !w-40 !py-1" value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
                  <option value="boteco">Boteco do interior</option>
                  <option value="galpao">Galpão gaúcho</option>
                  <option value="bar">Bar de esquina</option>
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button className="btn !py-3 text-lg" disabled={!connected} onClick={() => void net.create(roomSettings(false), true)}>
                ▶ Jogar contra bots
              </button>
              <button className="btn !py-3 text-lg" disabled={!connected} onClick={() => void net.quick(modeId, format)}>
                ⚡ Partida rápida online
              </button>
              <button className="btn" disabled={!connected} onClick={() => void net.create(roomSettings(false))}>
                Criar sala com amigos
              </button>
              <div className="flex gap-1">
                <input className="field uppercase" placeholder="Código da sala" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                <button className="btn" disabled={!connected || code.length !== 6} onClick={() => void net.join(code)}>Entrar</button>
                <button className="btn-ghost" disabled={!connected || code.length !== 6} title="Assistir" onClick={() => void net.join(code, true)}>👁</button>
              </div>
            </div>
            {!connected && <p className="mt-2 text-sm text-rose-300">Conectando ao servidor...</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
