import type { AvatarConfig } from '@truco/shared';
import type { BotPersonality } from './bot';

export interface Persona {
  id: string;
  name: string;
  description: string;
  personality: BotPersonality;
  avatar: AvatarConfig;
}

/** Elenco original do jogo. Cada personagem joga de um jeito quando é bot. */
export const PERSONAS: readonly Persona[] = [
  {
    id: 'tonico',
    name: 'Seu Tonico',
    description: 'Caipira calmo, blefa pouco',
    personality: { aggression: 0.3, bluff: 0.1 },
    avatar: { skin: '#c68a5e', hair: '#d9d9d9', shirt: '#b5462f', hat: 'palha', glasses: false, mustache: true },
  },
  {
    id: 'cida',
    name: 'Dona Cida',
    description: 'Esperta e risonha, adora pedir seis',
    personality: { aggression: 0.75, bluff: 0.4 },
    avatar: { skin: '#8d5a3b', hair: '#f0f0f0', shirt: '#7b3fa0', hat: 'nenhum', glasses: true, mustache: false },
  },
  {
    id: 'bagual',
    name: 'Bagual',
    description: 'Gaúcho do envido e da flor',
    personality: { aggression: 0.6, bluff: 0.3 },
    avatar: { skin: '#e0ac7e', hair: '#3b2a1e', shirt: '#f2efe6', hat: 'gaucho', glasses: false, mustache: true },
  },
  {
    id: 'juninho',
    name: 'Juninho Zap',
    description: 'Ansioso, truca toda hora',
    personality: { aggression: 0.95, bluff: 0.8 },
    avatar: { skin: '#6f4329', hair: '#1c1c1c', shirt: '#1f8a4c', hat: 'bone', glasses: false, mustache: false },
  },
  {
    id: 'lurdes',
    name: 'Professora Lurdes',
    description: 'Joga na matemática',
    personality: { aggression: 0.45, bluff: 0.05 },
    avatar: { skin: '#f0c9a4', hair: '#7a4a2b', shirt: '#2f5d9b', hat: 'nenhum', glasses: true, mustache: false },
  },
  {
    id: 'bigode',
    name: 'Mestre Bigode',
    description: 'Veterano blefador',
    personality: { aggression: 0.65, bluff: 1 },
    avatar: { skin: '#b97a4f', hair: '#2a2a2a', shirt: '#d9a521', hat: 'boina', glasses: false, mustache: true },
  },
];
