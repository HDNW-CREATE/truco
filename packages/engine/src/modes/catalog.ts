import type { ModeConfig, ModeId, ModeOptions } from '@truco/shared';
import { createEspanhol, createGauderio, createUruguaio, createValenciano } from './espanhois';
import { createMineiro } from './mineiro';
import { createPaulista } from './paulista';

/** Monta o ModeConfig a partir do id do modo e das opções da sala. */
export function buildMode(id: ModeId, options: ModeOptions = {}): ModeConfig {
  let config: ModeConfig;
  switch (id) {
    case 'paulista':
      config = createPaulista(options);
      break;
    case 'mineiro':
      config = createMineiro();
      break;
    case 'gauderio':
      config = createGauderio({ flor: options.flor ?? true });
      break;
    case 'espanhol':
      config = createEspanhol({ flor: options.flor ?? false });
      break;
    case 'uruguaio':
      config = createUruguaio();
      break;
    case 'valenciano':
      config = createValenciano();
      break;
  }
  if (options.pointsToWin !== undefined) config.pointsToWin = options.pointsToWin;
  if (options.sinais !== undefined) config.special.sinaisPermitidos = options.sinais;
  return config;
}

export const MODE_IDS: readonly ModeId[] = [
  'paulista',
  'mineiro',
  'gauderio',
  'espanhol',
  'uruguaio',
  'valenciano',
];
