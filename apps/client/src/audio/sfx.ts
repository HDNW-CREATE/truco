// Sons gerados na hora com a Web Audio API (sem arquivos de áudio) e falas pela síntese de voz
// do navegador. O som de cada jogador vem do lado em que ele está sentado.
import { useSettings } from '../store/settings';

let ctx: AudioContext | null = null;
let musicTimer: number | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Liga a saída a um controle de volume e de lado (pan de -1 a 1). */
function output(ac: AudioContext, volume: number, pan: number): AudioNode {
  const gain = ac.createGain();
  gain.gain.value = volume;
  const panner = ac.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  gain.connect(panner).connect(ac.destination);
  return gain;
}

function noise(ac: AudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const source = ac.createBufferSource();
  source.buffer = buffer;
  return source;
}

function tone(freq: number, seconds: number, volume: number, pan: number, type: OscillatorType = 'sine', delay = 0): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  const start = ac.currentTime + delay;
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(1, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(env).connect(output(ac, volume, pan));
  osc.start(start);
  osc.stop(start + seconds + 0.05);
}

export type Sfx = 'carta' | 'soco' | 'ponto' | 'embaralhar' | 'vitoria' | 'clique';

export function playSfx(kind: Sfx, pan = 0): void {
  const volume = useSettings.getState().sfx;
  const ac = audio();
  if (!ac || volume <= 0) return;
  if (kind === 'carta' || kind === 'embaralhar') {
    const bursts = kind === 'carta' ? 1 : 6;
    for (let i = 0; i < bursts; i++) {
      const source = noise(ac, 0.07);
      const filter = ac.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1800;
      source.connect(filter).connect(output(ac, volume * 0.5, pan));
      source.start(ac.currentTime + i * 0.09);
    }
  } else if (kind === 'soco') {
    tone(70, 0.35, volume, pan, 'sine');
    const source = noise(ac, 0.12);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    source.connect(filter).connect(output(ac, volume * 0.9, pan));
    source.start();
  } else if (kind === 'ponto') {
    tone(880, 0.25, volume * 0.35, pan, 'triangle');
    tone(1320, 0.3, volume * 0.3, pan, 'triangle', 0.09);
  } else if (kind === 'vitoria') {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, volume * 0.35, 0, 'triangle', i * 0.13));
  } else {
    tone(600, 0.06, volume * 0.2, pan, 'square');
  }
}

/** Fala em voz alta usando a síntese do navegador; cada lugar tem um tom de voz. */
export function speak(text: string, seat: number): void {
  const volume = useSettings.getState().voice;
  if (volume <= 0 || typeof speechSynthesis === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.volume = volume;
  utterance.pitch = 0.7 + (seat % 4) * 0.25;
  utterance.rate = 1.15;
  speechSynthesis.speak(utterance);
}

const SCALES: Record<string, number[]> = {
  boteco: [196, 247, 294, 330, 392, 330, 294, 247],
  galpao: [220, 262, 330, 294, 262, 247, 220, 165],
  bar: [262, 311, 349, 392, 466, 392, 349, 311],
};

/** Trilha ambiente simples: notas dedilhadas em laço, diferentes por cenário. */
export function startMusic(scenario: string): void {
  stopMusic();
  const notes = SCALES[scenario] ?? (SCALES.boteco as number[]);
  let step = 0;
  musicTimer = window.setInterval(() => {
    const volume = useSettings.getState().music;
    if (volume <= 0) return;
    const note = notes[step % notes.length] as number;
    tone(note, 0.9, volume * 0.18, 0, 'triangle');
    if (step % 4 === 0) tone(note / 2, 1.4, volume * 0.14, 0, 'sine');
    step++;
  }, 420);
}

export function stopMusic(): void {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
}
