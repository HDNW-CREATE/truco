import type { ModeId, TableFormat } from '@truco/shared';

export interface ModeInfo {
  id: ModeId;
  name: string;
  short: string;
  deck: 'frances' | 'espanhol';
  /** Passos do tutorial "Como jogar". */
  tutorial: string[];
}

export const MODES: ModeInfo[] = [
  {
    id: 'paulista',
    name: 'Truco Paulista',
    short: 'Com vira e manilha. Até 12 pontos.',
    deck: 'frances',
    tutorial: [
      'Cada jogador recebe 3 cartas e uma carta é virada na mesa: a vira. A manilha é a carta logo acima da vira.',
      'Da menor para a maior: 4, 5, 6, 7, Q, J, K, A, 2, 3. As manilhas ganham de todas, e entre elas vale o naipe: ouros, espadas, copas e paus (o zap).',
      'A mão tem 3 rodadas. Quem ganhar 2 leva a mão, que vale 1 ponto.',
      'Na sua vez você pode pedir TRUCO: a mão passa a valer 3. O adversário aceita, corre (você leva 1) ou pede SEIS. Depois vêm NOVE e DOZE.',
      'Se a 1ª rodada empatar, ganha quem fizer a 2ª. Se a 2ª ou a 3ª empatar, ganha quem fez a 1ª.',
      'Com 11 pontos é a mão de onze: você vê as cartas do parceiro e decide se joga (vale 3) ou corre. Com 11 a 11 é a mão de ferro: todos jogam no escuro.',
      'A partir da 2ª rodada dá para jogar uma carta coberta, que não vale nada.',
    ],
  },
  {
    id: 'mineiro',
    name: 'Truco Mineiro',
    short: 'Manilhas fixas, sem vira. A mão vale 2.',
    deck: 'frances',
    tutorial: [
      'Não tem vira. As manilhas são sempre as mesmas: zap (4 de paus), copas (7 de copas), espadilha (ás de espadas) e pica-fumo (7 de ouros).',
      'Depois delas vêm 3, 2, A, K, J, Q, 7, 6, 5 e 4.',
      'A mão vale 2 pontos. Truco vale 4, seis vale 8, nove vale 10 e doze vale 12.',
      'A partida vai até 12 e tem mão de onze, mão de ferro e carta coberta, como no Paulista.',
    ],
  },
  {
    id: 'gauderio',
    name: 'Truco Gaudério',
    short: 'Baralho espanhol, envido e flor.',
    deck: 'espanhol',
    tutorial: [
      'Baralho espanhol de 40 cartas. As mais fortes: ás de espadas, ás de paus, 7 de espadas e 7 de ouros. Depois os 3, os 2, os ases falsos, reis, cavalos, sotas, setes falsos, 6, 5 e 4.',
      'A mão vale 1. Truco vale 2, retruco vale 3 e vale quatro vale 4.',
      'ENVIDO: só na primeira rodada, antes de jogar sua carta. Duas cartas do mesmo naipe somam os valores mais 20 (figuras valem 0). Quem tiver mais leva os pontos; no empate ganha o mão.',
      'Envido vale 2, real envido vale 3 e falta envido vale o que falta para fechar a partida.',
      'FLOR: três cartas do mesmo naipe valem 3 pontos e anulam o envido. Se o adversário também tiver flor, pode responder com contraflor.',
      'Se três rodadas empatarem, a mão é de quem é mão.',
    ],
  },
  {
    id: 'espanhol',
    name: 'Truco Espanhol',
    short: 'Estilo argentino, até 30 (malas e buenas).',
    deck: 'espanhol',
    tutorial: [
      'Mesmo baralho e mesmas cartas fortes do Gaudério.',
      'A partida vai até 30: de 0 a 15 são as "malas" e de 15 a 30 as "buenas".',
      'Falta envido: se os dois times estão nas malas, quem ganha leva a partida. Senão, vale o que falta para quem está na frente.',
      'Em trios (3x3), entre 5 e 25 pontos acontece o pica-pica: cada jogador enfrenta sozinho o rival sentado de frente.',
    ],
  },
  {
    id: 'uruguaio',
    name: 'Truco Uruguaio',
    short: 'Com muestra e piezas. Flor obrigatória.',
    deck: 'espanhol',
    tutorial: [
      'Uma carta é virada na mesa: a muestra. As cartas 2, 4, 5, cavalo (11) e sota (10) do naipe dela são as piezas, mais fortes que o ás de espadas.',
      'Se a muestra for uma pieza, o rei (12) do mesmo naipe assume o lugar dela.',
      'No envido as piezas valem muito: o 2 vale 30, o 4 vale 29, o 5 vale 28 e o cavalo e a sota valem 27, somados à maior das outras cartas.',
      'Quem tem flor é obrigado a cantar.',
    ],
  },
  {
    id: 'valenciano',
    name: 'Truc Valenciano',
    short: 'O original da Espanha, com 22 cartas.',
    deck: 'espanhol',
    tutorial: [
      'Baralho reduzido a 22 cartas: sem os 2, sem as figuras e sem os ases de ouros e copas.',
      'O envit funciona como o envido. Não tem flor.',
      'O truc sobe para retruc, quatre val e joc fora, que vale a partida inteira.',
      'As regras desta versão são aproximadas: as variações regionais podem ser diferentes.',
    ],
  },
];

export const FORMATS: { id: TableFormat; name: string }[] = [
  { id: '1x1', name: 'Mano a mano' },
  { id: '2x2', name: 'Duplas' },
  { id: '3x3', name: 'Trios' },
];

export const modeInfo = (id: ModeId): ModeInfo => MODES.find((m) => m.id === id) ?? (MODES[0] as ModeInfo);

export const QUICK_PHRASES = ['Truco, ladrão!', 'Desce!', 'Bah, tchê!', 'Uai, sô!', 'Tá com medo?', 'Boa, parceiro!', 'Essa doeu...', 'Vamo que vamo!'];
export const EMOTES = ['😂', '😎', '😱', '👏', '🤔', '😤'];
