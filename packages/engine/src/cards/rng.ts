// Gerador aleatório determinístico (mulberry32). O estado é um número inteiro,
// então cabe no GameState e permite reproduzir qualquer partida pela seed.

export interface RandomStep {
  /** Número em [0, 1). */
  value: number;
  /** Estado a ser usado na próxima chamada. */
  state: number;
}

/** Gera o próximo número aleatório a partir do estado atual, sem efeitos colaterais. */
export function nextRandom(state: number): RandomStep {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}

/** Sorteia um inteiro em [0, max). */
export function nextInt(state: number, max: number): { value: number; state: number } {
  const step = nextRandom(state);
  return { value: Math.floor(step.value * max), state: step.state };
}

/** Embaralha (Fisher-Yates) sem alterar a lista original. */
export function shuffle<T>(items: readonly T[], state: number): { items: T[]; state: number } {
  const result = [...items];
  let current = state;
  for (let i = result.length - 1; i > 0; i--) {
    const step = nextInt(current, i + 1);
    current = step.state;
    const a = result[i] as T;
    result[i] = result[step.value] as T;
    result[step.value] = a;
  }
  return { items: result, state: current };
}
