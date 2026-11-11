// Tipos compartilhados entre motor, servidor e cliente.

// ---------- Cartas ----------
export type DeckKind = 'frances' | 'espanhol';
/** No baralho espanhol, "paus" corresponde a bastos. */
export type Suit = 'ouros' | 'espadas' | 'copas' | 'paus';

export type FrenchRank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type SpanishRank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '10' | '11' | '12';
export type Rank = FrenchRank | SpanishRank | 'CORINGA';

export interface Card {
  /** Identificador único no baralho, ex.: "4-paus", "1-espadas", "CORINGA-1". */
  readonly id: string;
  readonly rank: Rank;
  /** null só para o coringa. */
  readonly suit: Suit | null;
}

// ---------- Configuração de modo ----------
export type ModeId = 'paulista' | 'mineiro' | 'gauderio' | 'espanhol' | 'uruguaio' | 'valenciano';
export type TableFormat = '1x1' | '2x2' | '3x3';

/** Padrão de carta: sem naipe significa "qualquer naipe". */
export interface CardPattern {
  rank: Rank;
  suit?: Suit;
}

export type StrengthRule =
  /** Paulista: a vira define a manilha. commonOrder vai da menor para a maior. */
  | { kind: 'vira'; commonOrder: Rank[]; manilhaSuitOrder: Suit[] }
  /** Hierarquia fixa: degraus da maior para a menor. */
  | { kind: 'fixa'; ladder: CardPattern[][] }
  /** Uruguaio: piezas do naipe da muestra (da maior para a menor) e depois a escada fixa. */
  | { kind: 'muestra'; piezaRanks: SpanishRank[]; ladder: CardPattern[][] };

export interface BetStep {
  name: string;
  /** Quantas vezes o degrau pode ser cantado na mesma mão (padrão 1). */
  maxRepeat?: number;
  /** 'partida' = vale a partida inteira (ex.: Joc Fora). */
  value: number | 'partida';
}

export interface ModeConfig {
  id: ModeId;
  name: string;
  /** Rótulo do submodo, ex.: "limpo", "sujo", "com flor". */
  variant: string;
  deck: { kind: DeckKind; removedRanks: Rank[]; removedCards?: CardPattern[]; jokers: number };
  strength: StrengthRule;
  /** Valor da mão sem aposta: 1 no Paulista, 2 no Mineiro. */
  baseHandValue: number;
  trucoLadder: BetStep[];
  pointsToWin: number;
  envido?: {
    steps: BetStep[];
    /** Nome da aposta "falta" (vale o que falta para fechar a partida). */
    faltaName: string;
    malasBuenas: boolean;
    /** Uruguaio: valor de cada pieza no envido e na flor. */
    piezaValues?: Partial<Record<SpanishRank, number>>;
  };
  flor?: { value: number; mandatory: boolean; contraflor: boolean };
  special: {
    maoDeOnze: boolean;
    maoDeFerro: boolean;
    cartaCoberta: boolean;
    picaPica?: { from: number; to: number };
    sinaisPermitidos: boolean;
  };
  /** No rioplatense, o empate favorece o mão. */
  tieRule: 'brasileiro' | 'rioplatense';
}

// ---------- Estado ----------
export type PlayerId = string;
export type TeamId = 0 | 1;

export interface Player {
  id: PlayerId;
  name: string;
  /** Lugar na mesa. A ordem crescente é o sentido do jogo (anti-horário). */
  seat: number;
  team: TeamId;
  isBot: boolean;
}

export interface PlayedCard {
  playerId: PlayerId;
  card: Card;
  faceDown: boolean;
}

export interface Trick {
  plays: PlayedCard[];
  winner: TeamId | 'empate' | null;
}

export interface PendingBet {
  kind: 'truco' | 'envido' | 'flor';
  step: string;
  by: PlayerId;
  awaiting: TeamId;
  /** Flor: só estes jogadores (os que também têm flor) podem responder. */
  eligible?: PlayerId[];
}

/** Quem corta o baralho: o adversário à esquerda do pé (joga logo antes dele) ou o mão. */
export type CutterRule = 'esquerda' | 'mao';

/** Opções da mesa que não dependem do modo de jogo. */
export interface GameOptions {
  /** Antes de cada mão o pé embaralha e um adversário corta. Desligado = distribui direto. */
  shuffleAndCut: boolean;
  cutter: CutterRule;
  /** Malandragem liberada (trapaças de brincadeira). A partida não conta para ranking. */
  cheats: boolean;
  /** Quantas malandragens cada jogador pode fazer na partida. */
  cheatLimit: number;
}

// ---------- Malandragens ----------
export type CheatKind = 'manga' | 'usar_manga' | 'espiar' | 'passar' | 'viciado' | 'olhar_corte' | 'ponto';

/** Gestos rápidos do personagem. Os mesmos aparecem à toa, sem trapaça nenhuma. */
export type GestureKind = 'nariz' | 'chapeu' | 'tosse' | 'espreguicar' | 'olhar_lado';

/** Pedido de malandragem feito durante a mão (as do baralho vêm junto com embaralhar e cortar). */
export type CheatRequest =
  /** Guarda a carta na manga e puxa outra do monte. */
  | { kind: 'manga'; cardId: string }
  /** Troca uma carta da mão pela que está na manga. */
  | { kind: 'usar_manga'; cardId: string }
  /** Inclina o corpo e vê uma carta de quem está sentado ao lado. */
  | { kind: 'espiar'; target: PlayerId }
  /** Oferece uma carta ao parceiro por baixo da mesa; ele aceita dando outra ou recusa. */
  | { kind: 'passar'; cardId: string; to: PlayerId }
  /** Marca um tento a mais no placar do próprio time. */
  | { kind: 'ponto' };

/** O que é preciso para desfazer uma malandragem se alguém gritar "Pega ladrão!". */
export type CheatUndo =
  | { kind: 'manga'; guarded: Card; drawn: Card }
  | { kind: 'usar_manga'; fromSleeve: Card; toSleeve: Card }
  | { kind: 'passar'; a: PlayerId; aCard: Card; b: PlayerId; bCard: Card }
  | { kind: 'ponto'; team: TeamId }
  | { kind: 'viciado' }
  | { kind: 'espiar' }
  | { kind: 'olhar_corte' };

export interface CheatRecord {
  id: number;
  by: PlayerId;
  /** Quem participou (no passar carta, os dois parceiros). */
  participants: PlayerId[];
  kind: CheatKind;
  /** Mão em que aconteceu: cartas só voltam atrás dentro da mesma mão. */
  handNumber: number;
  /** Ainda dá para denunciar (a janela de 5 s não fechou e ninguém denunciou). */
  open: boolean;
  undo: CheatUndo;
}

/** Algo que só um jogador vê, por um instante (espiar, olhar o corte). */
export interface Reveal {
  to: PlayerId;
  kind: 'espiar' | 'olhar_corte';
  card: Card;
  /** De quem é a carta espiada. */
  owner: PlayerId | null;
}

export interface PassOffer {
  from: PlayerId;
  to: PlayerId;
  cardId: string;
}

/** Embaralhar e cortar: o que todos na mesa podem ver (nunca a ordem do baralho). */
export interface DeckPrep {
  shuffler: PlayerId;
  cutter: PlayerId;
  /** Quantas vezes o pé embaralhou (0 = ainda não embaralhou). */
  shuffles: number;
  /** Altura de cada corte; null = ainda não cortou; [] = bateu na mesa. */
  cuts: number[] | null;
  deckSize: number;
}

export interface HandState {
  dealerSeat: number;
  /** Preparação do baralho antes de distribuir (só com embaralhar e cortar ligado). */
  prep: DeckPrep | null;
  /** Quem joga primeiro (o "mão"). */
  maoSeat: number;
  /** Jogadores que participam desta mão, na ordem do jogo a partir do mão. */
  active: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  /** Cartas como foram distribuídas (para envido e flor). Nunca sai do servidor. */
  dealt: Record<PlayerId, Card[]>;
  /** Vira (Paulista) ou muestra (Uruguaio). */
  turnedCard: Card | null;
  tricks: Trick[];
  turn: PlayerId;
  handValue: number;
  /** Degrau do truco já aceito (-1 = nenhum). */
  trucoLevel: number;
  /** Mão de onze e mão de ferro: ninguém pode pedir truco. */
  noTruco: boolean;
  /** Quem aumentou por último não pode aumentar de novo. */
  lastRaiseBy: TeamId | null;
  pendingBet: PendingBet | null;
  envido: { chain: string[]; resolved: boolean; points: number };
  flor: { declaredBy: PlayerId[]; resolved: boolean };
  /** Time que venceu a mão (null = ninguém ou mão em andamento). */
  winner: TeamId | null;
  /** Mão de ferro: ninguém vê as próprias cartas. */
  blind: boolean;
  maoDeOnzeTeam: TeamId | null;
  picaPicaDuel: [PlayerId, PlayerId] | null;
  /** Passar carta: oferta esperando o parceiro aceitar. */
  passOffer: PassOffer | null;
}

export type GamePhase =
  | 'embaralhando'
  | 'cortando'
  | 'jogando'
  | 'aguardando_resposta'
  | 'decisao_mao_de_onze'
  | 'fim_da_mao'
  | 'fim_de_partida';

export interface GameState {
  readonly config: ModeConfig;
  readonly format: TableFormat;
  readonly players: Player[];
  /** Seed original: seed + history permitem reproduzir a partida. */
  readonly seed: number;
  readonly options: GameOptions;
  /** Estado atual do gerador aleatório; avança a cada embaralhada. */
  rngState: number;
  /** Baralho na mão do pé durante o embaralhar e cortar. Nunca sai do servidor. */
  deck: Card[] | null;
  /** Monte que sobrou depois de distribuir (a carta na manga puxa daqui). Nunca sai do servidor. */
  stock: Card[];
  cheats: {
    records: CheatRecord[];
    /** Malandragens já usadas por jogador. */
    used: Record<PlayerId, number>;
    /** Cartas guardadas na manga, fora do baralho até serem usadas. */
    sleeves: Record<PlayerId, Card[]>;
    nextId: number;
  };
  /** O que cada um viu escondido na última ação. Só vai para a visão do dono. */
  reveals: Reveal[];
  score: [number, number];
  handNumber: number;
  /** Duelos de pica-pica ainda por jogar. */
  picaPicaQueue: [PlayerId, PlayerId][];
  /** Já houve uma mão normal ("redondo") desde o último pica-pica. */
  redondoPlayed: boolean;
  hand: HandState;
  phase: GamePhase;
  winner: TeamId | null;
  history: Action[];
}

// ---------- Ações ----------
export type Action =
  | { type: 'JOGAR_CARTA'; playerId: PlayerId; cardId: string; faceDown?: boolean }
  | { type: 'PEDIR_TRUCO'; playerId: PlayerId }
  | { type: 'CANTAR_ENVIDO'; playerId: PlayerId; step: string }
  | {
      type: 'CANTAR_FLOR';
      playerId: PlayerId;
      step: 'flor' | 'contraflor' | 'contraflor_ao_resto';
    }
  | { type: 'RESPONDER'; playerId: PlayerId; accept: boolean }
  | { type: 'CORRER'; playerId: PlayerId }
  | { type: 'DECIDIR_MAO_DE_ONZE'; playerId: PlayerId; play: boolean }
  /**
   * O pé embaralha: cada vez é um embaralhamento tirado da seed.
   * Baralho viciado (malandragem): depois de embaralhar, a carta escolhida vai para o topo ou o fundo.
   */
  | {
      type: 'EMBARALHAR';
      playerId: PlayerId;
      times: number;
      stack?: { cardId: string; position: 'topo' | 'fundo' };
    }
  /**
   * Cada corte tira essa quantidade de cartas de cima e põe embaixo. Lista vazia = bater na mesa.
   * Olhar o corte (malandragem): quem corta vê a carta que ficou embaixo.
   */
  | { type: 'CORTAR'; playerId: PlayerId; cuts: number[]; peek?: boolean }
  | { type: 'MALANDRAGEM'; playerId: PlayerId; cheat: CheatRequest }
  /** Resposta do parceiro ao passar carta: a carta que ele dá em troca, ou null para recusar. */
  | { type: 'RESPONDER_PASSE'; playerId: PlayerId; cardId: string | null }
  /** "Pega ladrão!" contra um adversário. */
  | { type: 'DENUNCIAR'; playerId: PlayerId; target: PlayerId }
  /** Só o servidor manda: fecha a janela de denúncia de uma malandragem (playerId = quem trapaceou). */
  | { type: 'FECHAR_MALANDRAGEM'; playerId: PlayerId; id: number };

export type SpeechKind = 'truco' | 'aceite' | 'recusa' | 'envido' | 'flor' | 'corre' | 'onze';

export type GameEvent =
  /** Gesto rápido de um personagem. O servidor tira dos eventos e manda à parte, igual aos gestos à toa. */
  | { type: 'GESTO'; playerId: PlayerId; gesture: GestureKind }
  | {
      type: 'PEGA_LADRAO';
      by: PlayerId;
      target: PlayerId;
      /** Acertou: havia malandragem aberta. */
      correct: boolean;
      /** Qual malandragem foi pega (null se a acusação era falsa). */
      kind: CheatKind | null;
      /** Time que perdeu pontos e quantos. */
      penalty: { team: TeamId; points: number };
    }
  | { type: 'VEZ_DE_EMBARALHAR'; playerId: PlayerId; handNumber: number }
  | { type: 'BARALHO_EMBARALHADO'; playerId: PlayerId; times: number }
  | { type: 'BARALHO_CORTADO'; playerId: PlayerId; cuts: number[] }
  | { type: 'CARTAS_DISTRIBUIDAS'; handNumber: number }
  | { type: 'MAO_DE_ONZE'; team: TeamId }
  | { type: 'MAO_DE_FERRO' }
  | { type: 'PICA_PICA'; duel: [PlayerId, PlayerId] }
  | { type: 'CARTA_JOGADA'; play: ViewPlayedCard }
  | { type: 'VAZA_ENCERRADA'; winner: TeamId | 'empate'; index: number }
  | { type: 'FALA'; playerId: PlayerId; text: string; kind: SpeechKind }
  | { type: 'APOSTA_CANTADA'; bet: PendingBet }
  | { type: 'APOSTA_RESPONDIDA'; accepted: boolean; kind: PendingBet['kind'] }
  | { type: 'ENVIDO_RESOLVIDO'; winner: TeamId; points: number; values: [number, number] | null }
  | { type: 'FLOR_RESOLVIDA'; winner: TeamId; points: number }
  | { type: 'MAO_ENCERRADA'; winner: TeamId | null; points: number }
  | { type: 'PARTIDA_ENCERRADA'; winner: TeamId };

// ---------- Visões filtradas ----------
/** Carta jogada como aparece para quem olha: carta coberta vem sem rank e naipe. */
export interface ViewPlayedCard {
  playerId: PlayerId;
  card: Card | null;
  faceDown: boolean;
}

export interface ViewTrick {
  plays: ViewPlayedCard[];
  winner: TeamId | 'empate' | null;
}

/** O que qualquer pessoa na mesa pode ver, inclusive espectadores. */
export interface SpectatorView {
  config: ModeConfig;
  format: TableFormat;
  players: Player[];
  active: PlayerId[];
  handNumber: number;
  winner: TeamId | null;
  trucoLevel: number;
  noTruco: boolean;
  lastRaiseBy: TeamId | null;
  blind: boolean;
  maoDeOnzeTeam: TeamId | null;
  picaPicaDuel: [PlayerId, PlayerId] | null;
  /** Só a quantidade de cartas na mão de cada jogador. */
  cardCounts: Record<PlayerId, number>;
  turnedCard: Card | null;
  tricks: ViewTrick[];
  score: [number, number];
  handValue: number;
  dealerSeat: number;
  maoSeat: number;
  turn: PlayerId;
  pendingBet: PendingBet | null;
  phase: GamePhase;
  /** Embaralhar e cortar em andamento (null fora dessas etapas). */
  prep: DeckPrep | null;
  /** Opções da mesa (embaralhar e cortar, malandragem). */
  tableOptions: GameOptions;
}

export interface PlayerView extends SpectatorView {
  me: PlayerId;
  /** null na mão de ferro (o jogador não vê as próprias cartas). */
  myCards: Card[] | null;
  /** As 3 cartas recebidas (para calcular envido e flor); null na mão de ferro. */
  myDealtCards: Card[] | null;
  /** Cartas dos parceiros: só durante a decisão da mão de onze. */
  partnerCards: Record<PlayerId, Card[]> | null;
  /**
   * Baralho recolhido, aberto, como o pé vê antes de embaralhar (de cima para baixo).
   * Só para o pé e só antes de embaralhar: depois da embaralhada ninguém vê a ordem.
   */
  deckFaceUp: Card[] | null;
  /** Malandragens que ainda posso fazer (null = malandragem desligada). */
  cheatsLeft: number | null;
  /** Cartas na minha manga. */
  mySleeve: Card[];
  /** O que vi escondido na última ação (espiar, olhar o corte). */
  myReveals: Reveal[];
  /** Parceiro me oferecendo uma carta por baixo da mesa (com a carta oferecida). */
  incomingPass: { from: PlayerId; card: Card } | null;
  /** Minha oferta esperando resposta. */
  outgoingPass: { to: PlayerId; cardId: string } | null;
  /** Malandragens que posso pedir agora. */
  cheatOptions: CheatRequest[];
  legalActions: Action[];
}
