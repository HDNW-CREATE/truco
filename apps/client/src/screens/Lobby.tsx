import type { RoomSettings } from '@truco/shared';
import { FORMATS, MODES, modeInfo } from '../data/modes';
import { net, useGame } from '../store/game';

/** Sala de espera: lugares, bots, configurações (só o dono muda) e botão de começar. */
export function Lobby() {
  const room = useGame((s) => s.room);
  const chat = useGame((s) => s.chat);
  if (!room) return null;
  const { settings } = room;
  const host = room.yourSeat !== null && room.yourSeat === room.hostSeat;
  const me = room.yourSeat !== null ? room.seats[room.yourSeat] : null;
  const change = (partial: Partial<RoomSettings>): void => net.settings({ ...settings, ...partial });
  const option = (partial: RoomSettings['options']): void => change({ options: { ...settings.options, ...partial } });
  const link = `${location.origin}/?sala=${room.code}`;
  const hasFlor = settings.modeId === 'gauderio' || settings.modeId === 'espanhol';
  const spanish = modeInfo(settings.modeId).deck === 'espanhol';

  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-stone-900 to-amber-950 p-3">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-black text-amber-300">Sala {room.code}</h1>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(link)}>Copiar convite</button>
            <button className="btn-ghost" onClick={net.leave}>Sair</button>
          </div>
        </div>

        <div className="panel mb-3">
          <h2 className="mb-2 font-bold">Lugares <span className="text-xs font-normal opacity-60">(times alternados: pares contra ímpares)</span></h2>
          <div className="grid grid-cols-2 gap-2">
            {room.seats.map((seat, i) => (
              <div key={i} className={`flex items-center justify-between rounded-xl border p-2 ${i % 2 === 0 ? 'border-emerald-400/40' : 'border-rose-400/40'} bg-black/25`}>
                <div>
                  <div className="text-xs opacity-60">Lugar {i + 1} · time {i % 2 === 0 ? 'A' : 'B'}</div>
                  <div className="font-bold">
                    {seat ? seat.name : <span className="opacity-40">vazio</span>}
                    {seat?.kind === 'bot' && ' 🤖'}
                    {i === room.hostSeat && ' ⭐'}
                    {seat?.kind === 'humano' && seat.ready && ' ✓'}
                  </div>
                </div>
                <div className="flex gap-1">
                  {!seat && room.yourSeat !== null && <button className="btn-ghost !py-1 text-sm" onClick={() => net.sit(i)}>Sentar</button>}
                  {!seat && host && <button className="btn-ghost !py-1 text-sm" onClick={() => net.addBot(i)}>+ Bot</button>}
                  {seat?.kind === 'bot' && host && <button className="btn-ghost !py-1 text-sm" onClick={() => net.removeBot(i)}>Tirar</button>}
                </div>
              </div>
            ))}
          </div>
          {room.spectators > 0 && <p className="mt-2 text-sm opacity-70">👁 {room.spectators} assistindo</p>}
        </div>

        <div className="panel mb-3 text-sm">
          <h2 className="mb-2 text-base font-bold">Configurações {!host && <span className="text-xs font-normal opacity-60">(só o dono da sala muda)</span>}</h2>
          <fieldset disabled={!host} className="grid gap-2 sm:grid-cols-2">
            <label>Modo
              <select className="field" value={settings.modeId} onChange={(e) => change({ modeId: e.target.value as RoomSettings['modeId'], options: {} })}>
                {MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label>Formato
              <select className="field" value={settings.format} onChange={(e) => change({ format: e.target.value as RoomSettings['format'] })}>
                {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
              </select>
            </label>
            <label>Pontos para vencer
              <input className="field" type="number" min={3} max={40} placeholder="padrão do modo" value={settings.options.pointsToWin ?? ''} onChange={(e) => option({ pointsToWin: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
            <label>Tempo por jogada
              <select className="field" value={settings.turnSeconds} onChange={(e) => change({ turnSeconds: Number(e.target.value) as 15 | 30 | 60 })}>
                <option value={15}>15 s</option><option value={30}>30 s</option><option value={60}>60 s</option>
              </select>
            </label>
            <label>Nível dos bots
              <select className="field" value={settings.botLevel} onChange={(e) => change({ botLevel: e.target.value as RoomSettings['botLevel'] })}>
                <option value="facil">Fácil</option><option value="medio">Médio</option><option value="dificil">Difícil</option>
              </select>
            </label>
            <label>Cenário
              <select className="field" value={settings.scenario} onChange={(e) => change({ scenario: e.target.value as RoomSettings['scenario'] })}>
                <option value="boteco">Boteco do interior</option><option value="galpao">Galpão gaúcho</option><option value="bar">Bar de esquina</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              {settings.modeId === 'paulista' && (
                <>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={settings.options.sujo ?? false} onChange={(e) => option({ sujo: e.target.checked })} /> Baralho sujo</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={settings.options.coringa ?? false} onChange={(e) => option({ coringa: e.target.checked })} /> Coringa</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={settings.options.manilhaVelha ?? false} onChange={(e) => option({ manilhaVelha: e.target.checked })} /> Manilha velha</label>
                </>
              )}
              {hasFlor && <label className="flex items-center gap-1"><input type="checkbox" checked={settings.options.flor ?? settings.modeId === 'gauderio'} onChange={(e) => option({ flor: e.target.checked })} /> Com flor</label>}
              {spanish && <label className="flex items-center gap-1"><input type="checkbox" checked={settings.options.sinais ?? true} onChange={(e) => option({ sinais: e.target.checked })} /> Sinais permitidos</label>}
              <label className="flex items-center gap-1" title="Antes de cada mão o pé embaralha e um adversário corta"><input type="checkbox" checked={settings.shuffleCut} onChange={(e) => change({ shuffleCut: e.target.checked })} /> Embaralhar e cortar</label>
              {settings.shuffleCut && (
                <label className="flex items-center gap-1">Quem corta:
                  <select className="field !w-auto !py-0.5" value={settings.cutter} onChange={(e) => change({ cutter: e.target.value as RoomSettings['cutter'] })}>
                    <option value="esquerda">o adversário à esquerda do pé</option>
                    <option value="mao">o mão (à direita do pé)</option>
                  </select>
                </label>
              )}
              <label className="flex items-center gap-1" title="Trapaças de brincadeira com Pega ladrão. A partida não conta para ranking nem ELO."><input type="checkbox" checked={settings.cheats} onChange={(e) => change({ cheats: e.target.checked })} /> 🤫 Malandragem liberada</label>
              {settings.cheats && (
                <label className="flex items-center gap-1">por jogador:
                  <input className="field !w-16 !py-0.5" type="number" min={1} max={10} value={settings.cheatLimit} onChange={(e) => change({ cheatLimit: Math.min(10, Math.max(1, Number(e.target.value) || 3)) })} />
                  <span className="text-xs opacity-60">(não conta para o ranking)</span>
                </label>
              )}
              <label className="flex items-center gap-1"><input type="checkbox" checked={settings.fillWithBots} onChange={(e) => change({ fillWithBots: e.target.checked })} /> Completar com bots</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={settings.isPublic} onChange={(e) => change({ isPublic: e.target.checked })} /> Sala pública (partida rápida)</label>
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {me && !host && <button className="btn" onClick={() => net.ready(!me.ready)}>{me.ready ? 'Cancelar pronto' : 'Estou pronto'}</button>}
          {host && <button className="btn !px-8 !py-3 text-lg" onClick={net.start}>Começar partida</button>}
          {!host && <span className="text-sm opacity-70">Esperando o dono da sala começar...</span>}
        </div>
        <div className="mt-3 text-sm opacity-70">
          {chat.slice(-4).map((m, i) => <div key={i}>{m.kind === 'sistema' ? m.text : `${m.name}: ${m.text}`}</div>)}
        </div>
      </div>
    </div>
  );
}
