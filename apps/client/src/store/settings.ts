import type { AvatarConfig } from '@truco/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Quality = 'baixa' | 'media' | 'alta';

export interface Settings {
  name: string;
  avatar: AvatarConfig;
  quality: Quality;
  /** Campo de visão da câmera, de 60 a 90 graus. */
  fov: number;
  music: number;
  sfx: number;
  voice: number;
  fontScale: number;
  /** Naipes em quatro cores, para quem confunde vermelho e preto. */
  colorblind: boolean;
  /** A visão volta ao centro depois de 3 s parada. */
  autoRecenter: boolean;
  /** A cabeça vira sozinha para quem cantou truco, envido ou flor. */
  autoLook: boolean;
  gyro: boolean;
  token: string | null;
  account: string | null;
  set: (partial: Partial<Settings>) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      name: '',
      avatar: { skin: '#c68a5e', hair: '#3b2a1e', shirt: '#2f5d9b', hat: 'nenhum', glasses: false, mustache: false },
      quality: 'media',
      fov: 72,
      music: 0.25,
      sfx: 0.8,
      voice: 0.8,
      fontScale: 1,
      colorblind: false,
      autoRecenter: true,
      autoLook: false,
      gyro: false,
      token: null,
      account: null,
      set: (partial) => set(partial),
    }),
    { name: 'truco.config' },
  ),
);
