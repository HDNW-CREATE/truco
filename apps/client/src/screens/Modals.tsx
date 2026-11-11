import type { AuthResponse, HatKind, ModeId, ProfileResponse, RankingEntry } from '@truco/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { MODES } from '../data/modes';
import { reconnect } from '../store/game';
import { useSettings, type Quality } from '../store/settings';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="panel max-h-[92vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-amber-300">{title}</h2>
          <button className="btn-ghost !py-1" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2 flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const slider = (value: number, key: 'music' | 'sfx' | 'voice') => (
    <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => s.set({ [key]: Number(e.target.value) })} />
  );
  return (
    <Modal title="Configurações" onClose={onClose}>
      <Row label="Qualidade gráfica">
        <select className="field !w-36" value={s.quality} onChange={(e) => s.set({ quality: e.target.value as Quality })}>
          <option value="baixa">Baixa (celular)</option>
          <option value="media">Média</option>
          <option value="alta">Alta (com desfoque)</option>
        </select>
      </Row>
      <Row label={`Campo de visão: ${s.fov}°`}>
        <input type="range" min={60} max={90} value={s.fov} onChange={(e) => s.set({ fov: Number(e.target.value) })} />
      </Row>
      <Row label="Música">{slider(s.music, 'music')}</Row>
      <Row label="Efeitos">{slider(s.sfx, 'sfx')}</Row>
      <Row label="Vozes">{slider(s.voice, 'voice')}</Row>
      <Row label={`Tamanho do texto: ${Math.round(s.fontScale * 100)}%`}>
        <input type="range" min={0.85} max={1.4} step={0.05} value={s.fontScale} onChange={(e) => s.set({ fontScale: Number(e.target.value) })} />
      </Row>
      <Row label="Naipes em quatro cores (daltonismo)">
        <input type="checkbox" checked={s.colorblind} onChange={(e) => s.set({ colorblind: e.target.checked })} />
      </Row>
      <Row label="Visão volta ao centro sozinha">
        <input type="checkbox" checked={s.autoRecenter} onChange={(e) => s.set({ autoRecenter: e.target.checked })} />
      </Row>
      <Row label="Virar a cabeça para quem cantou">
        <input type="checkbox" checked={s.autoLook} onChange={(e) => s.set({ autoLook: e.target.checked })} />
      </Row>
      <Row label="Olhar com o giroscópio (celular)">
        <input type="checkbox" checked={s.gyro} onChange={(e) => s.set({ gyro: e.target.checked })} />
      </Row>
      <p className="mt-2 text-xs opacity-60">Arraste o mouse ou o dedo na tela para olhar em volta da mesa.</p>
    </Modal>
  );
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Erro no servidor');
  return data;
}

export function AuthModal({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [mode, setMode] = useState<'entrar' | 'cadastrar'>('entrar');
  const [email, setEmail] = useState('');
  const [name, setName] = useState(s.name);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    try {
      const result = await post<AuthResponse>(mode === 'entrar' ? '/api/login' : '/api/register', { email, name, password });
      s.set({ token: result.token, account: result.name, name: result.name });
      reconnect();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro');
    }
  };

  if (s.account) {
    return (
      <Modal title="Minha conta" onClose={onClose}>
        <p className="mb-3">Você entrou como <b>{s.account}</b>.</p>
        <button
          className="btn"
          onClick={() => {
            s.set({ token: null, account: null });
            reconnect();
            onClose();
          }}
        >
          Sair da conta
        </button>
      </Modal>
    );
  }
  return (
    <Modal title={mode === 'entrar' ? 'Entrar' : 'Criar conta'} onClose={onClose}>
      <p className="mb-3 text-sm opacity-70">Com conta, suas partidas contam para o ranking e as conquistas. Dá para jogar sem conta, como convidado.</p>
      <input className="field mb-2" placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode === 'cadastrar' && <input className="field mb-2" placeholder="Nome na mesa (3 a 16 letras)" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />}
      <input className="field mb-2" placeholder="Senha (mínimo 6)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      {error && <p className="mb-2 text-sm text-rose-300">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn" onClick={() => void submit()}>{mode === 'entrar' ? 'Entrar' : 'Cadastrar'}</button>
        <button className="text-sm underline opacity-80" onClick={() => setMode(mode === 'entrar' ? 'cadastrar' : 'entrar')}>
          {mode === 'entrar' ? 'Não tenho conta' : 'Já tenho conta'}
        </button>
      </div>
    </Modal>
  );
}

export function RankingModal({ onClose }: { onClose: () => void }) {
  const account = useSettings((s) => s.account);
  const [mode, setMode] = useState<ModeId>('paulista');
  const [rows, setRows] = useState<RankingEntry[] | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);

  useEffect(() => {
    setRows(null);
    fetch(`/api/ranking?mode=${mode}`).then((r) => r.json()).then(setRows).catch(() => setRows([]));
  }, [mode]);
  useEffect(() => {
    if (account) fetch(`/api/profile/${encodeURIComponent(account)}`).then((r) => (r.ok ? r.json() : null)).then(setProfile).catch(() => null);
  }, [account]);

  return (
    <Modal title="Ranking e perfil" onClose={onClose}>
      {profile && (
        <div className="mb-3 rounded-xl bg-black/30 p-3 text-sm">
          <b className="text-amber-300">{profile.name}</b> · nível {profile.level} · {profile.xp} XP
          <div className="mt-1 flex flex-wrap gap-1">
            {profile.achievements.length === 0 && <span className="opacity-60">Nenhuma conquista ainda.</span>}
            {profile.achievements.map((a) => (
              <span key={a.key} className="rounded-full bg-amber-700/70 px-2 py-0.5 text-xs">🏆 {a.title}</span>
            ))}
          </div>
          {profile.stats.map((st) => (
            <div key={st.mode} className="mt-1 opacity-80">{st.mode}: {st.wins} vitórias em {st.games} partidas · ELO {st.elo}</div>
          ))}
        </div>
      )}
      <select className="field mb-2" value={mode} onChange={(e) => setMode(e.target.value as ModeId)}>
        {MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {rows === null && <p className="opacity-60">Carregando...</p>}
      {rows?.length === 0 && <p className="opacity-60">Ninguém jogou este modo com conta ainda.</p>}
      {rows?.map((r, i) => (
        <div key={r.name} className="flex justify-between border-b border-amber-100/10 py-1 text-sm">
          <span>{i + 1}. {r.name}</span>
          <span>ELO <b>{r.elo}</b> · {r.wins}/{r.games}</span>
        </div>
      ))}
    </Modal>
  );
}

export function TutorialModal({ onClose, onPractice }: { onClose: () => void; onPractice: (mode: ModeId) => void }) {
  const [mode, setMode] = useState<ModeId>('paulista');
  const [step, setStep] = useState(0);
  const info = MODES.find((m) => m.id === mode) ?? MODES[0];
  if (!info) return null;
  const last = step >= info.tutorial.length - 1;
  return (
    <Modal title="Como jogar" onClose={onClose}>
      <div className="mb-3 flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button key={m.id} className={`btn-ghost !py-1 text-sm ${m.id === mode ? '!bg-amber-700' : ''}`} onClick={() => { setMode(m.id); setStep(0); }}>
            {m.name.replace('Truco ', '').replace('Truc ', '')}
          </button>
        ))}
      </div>
      <div className="min-h-28 rounded-xl bg-black/30 p-4">
        <div className="mb-1 text-xs opacity-60">Passo {step + 1} de {info.tutorial.length}</div>
        <p className="text-base leading-relaxed">{info.tutorial[step]}</p>
      </div>
      <div className="mt-3 flex justify-between">
        <button className="btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>← Anterior</button>
        {last ? (
          <button className="btn" onClick={() => onPractice(mode)}>Praticar contra um bot fácil</button>
        ) : (
          <button className="btn" onClick={() => setStep(step + 1)}>Próximo →</button>
        )}
      </div>
    </Modal>
  );
}

const SKINS = ['#f0c9a4', '#e0ac7e', '#c68a5e', '#8d5a3b', '#6f4329', '#4a2c1a'];
const HAIRS = ['#1c1c1c', '#3b2a1e', '#7a4a2b', '#c9a24a', '#d9d9d9', '#a8322a'];
const SHIRTS = ['#2f5d9b', '#b5462f', '#1f8a4c', '#7b3fa0', '#d9a521', '#f2efe6', '#2b2b2b'];
const HATS: { id: HatKind; name: string }[] = [
  { id: 'nenhum', name: 'Sem chapéu' },
  { id: 'palha', name: 'Palha' },
  { id: 'bone', name: 'Boné' },
  { id: 'gaucho', name: 'Gaúcho' },
  { id: 'boina', name: 'Boina' },
];

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {colors.map((c) => (
        <button key={c} aria-label={c} className={`h-7 w-7 cursor-pointer rounded-full border-2 ${c === value ? 'border-amber-300' : 'border-black/40'}`} style={{ background: c }} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

/** Editor de aparência do personagem. */
export function AvatarEditor() {
  const avatar = useSettings((s) => s.avatar);
  const set = useSettings((s) => s.set);
  const update = (partial: Partial<typeof avatar>): void => set({ avatar: { ...avatar, ...partial } });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div><div className="mb-1 opacity-70">Pele</div><Swatches colors={SKINS} value={avatar.skin} onPick={(skin) => update({ skin })} /></div>
      <div><div className="mb-1 opacity-70">Cabelo</div><Swatches colors={HAIRS} value={avatar.hair} onPick={(hair) => update({ hair })} /></div>
      <div><div className="mb-1 opacity-70">Camisa</div><Swatches colors={SHIRTS} value={avatar.shirt} onPick={(shirt) => update({ shirt })} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="field !w-32" value={avatar.hat} onChange={(e) => update({ hat: e.target.value as HatKind })}>
          {HATS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={avatar.glasses} onChange={(e) => update({ glasses: e.target.checked })} /> Óculos</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={avatar.mustache} onChange={(e) => update({ mustache: e.target.checked })} /> Bigode</label>
      </div>
    </div>
  );
}
