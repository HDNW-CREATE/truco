# Truco na Mesa 3D

Jogo de truco online multiplayer em 3D, em primeira pessoa: cada jogador vê a mesa da sua cadeira.
Tudo original: personagens, cartas, cenários e sons foram criados para este projeto.

## Como rodar

Precisa de Node.js 20 ou mais novo e do pnpm (`npm install -g pnpm`).

```bash
pnpm install
pnpm preparar
pnpm dev
```

Abra http://localhost:5173. O `pnpm preparar` cria o arquivo `apps/server/.env` e o banco SQLite.
Para jogar com alguém na mesma rede, a outra pessoa abre `http://SEU-IP:5173`.

Outros comandos:

| Comando | O que faz |
|---|---|
| `pnpm test` | Roda os 207 testes (motor e servidor) |
| `pnpm coverage` | Testes com cobertura do motor |
| `pnpm typecheck` / `pnpm lint` | Checagem de tipos e de estilo |
| `pnpm cli --modo gauderio --formato 1x1` | Truco no terminal contra bots |
| `pnpm build` e `pnpm start` | Compila o cliente e sobe só o servidor, que entrega o jogo em http://localhost:3001 |

Opções do CLI: `--modo` (paulista, mineiro, gauderio, espanhol, uruguaio, valenciano), `--formato` (1x1, 2x2, 3x3),
`--nivel` (facil, medio, dificil), `--seed`, `--sujo`, `--coringa`, `--manilha-velha`, `--sem-flor`, `--com-flor`, `--cortar`, `--auto`.

## Estrutura

```
packages/shared   tipos e eventos de socket usados por todos
packages/engine   regras do truco, em TypeScript puro (sem tela e sem rede), bots e CLI
apps/server       Fastify + Socket.IO: salas, partidas, contas, ranking (Prisma + SQLite)
apps/client       Vite + React + React Three Fiber: cena 3D, interface e telas
```

Toda regra de truco mora só em `packages/engine`. O servidor valida cada jogada com o motor e manda a cada
cliente apenas a visão dele (`getPlayerView`): as cartas dos outros nunca saem do servidor.

## O que o jogo tem

**Modos:** Paulista (limpo, sujo, com coringa, manilha velha), Mineiro, Gaudério (com ou sem flor),
Espanhol estilo argentino (malas e buenas, pica-pica nos trios), Uruguaio (muestra e piezas) e Truc Valenciano.
Mesas de 1x1, 2x2 e 3x3.

**Regras:** vazas e empates, truco e aumentos, envido, real envido, falta envido, flor e contraflor,
mão de onze, mão de ferro (no escuro) e carta coberta.

**Embaralhar e cortar** (opção da sala, desligada por padrão): antes de cada mão o pé embaralha com o baralho
nas mãos, em primeira pessoa (cada clique ou arrastada para o lado é uma embaralhada, até 10). Depois um adversário
corta: arrasta sobre o baralho para escolher a altura, até 3 cortes, ou bate na mesa e não corta. Quem corta é
configurável na sala: o adversário à esquerda do pé (padrão) ou o mão. Cada etapa tem 10 s; se o tempo acabar,
o jogo faz sozinho. Bots embaralham e cortam sozinhos. No motor, cada embaralhada é um embaralhamento tirado da
seed e cada corte é uma rotação do baralho na altura escolhida; as ações `EMBARALHAR` e `CORTAR` entram no
histórico, e `replayGame` refaz a partida inteira a partir da seed, das opções e do histórico. A ordem do baralho
nunca sai do servidor: a visão mostra só quem embaralha, quem corta, quantas vezes e as alturas. A única
exceção é o pé, que vê o baralho recolhido aberto antes da primeira embaralhada (não dá vantagem: a ordem
muda ao embaralhar).

**Malandragem liberada** (opção da sala, desligada por padrão; a partida não conta para ranking, ELO, XP nem
conquistas). Cada jogador tem um número de malandragens por partida (1 a 10, padrão 3):

| Malandragem | Como funciona |
|---|---|
| Carta na manga | Guarda uma carta da mão e puxa outra do monte. A carta guardada fica fora do baralho até você usá-la: "tirar da manga" troca uma carta da mão por ela (não gasta outra malandragem, mas também faz gesto e pode ser pega). |
| Espiar | Inclina o corpo e vê, por 1 s, uma carta sorteada de quem está sentado ao seu lado. |
| Passar carta | Oferece uma carta ao parceiro por baixo da mesa; ele aceita escolhendo a carta que devolve, ou recusa (sem custo). Sem resposta em 10 s, conta como recusa. |
| Baralho viciado | Com embaralhar e cortar ligado: o pé escolhe no leque aberto uma carta para ficar no topo ou no fundo. |
| Olhar o corte | Com embaralhar e cortar ligado: quem corta vê a carta que ficou embaixo. |
| Ponto a mais | Marca um tento a mais para o próprio time (nunca o tento que fecharia a partida). |

Toda malandragem faz um gesto rápido do personagem (coçar o nariz, ajeitar o chapéu, tossir, espreguiçar,
olhar para o lado). Os mesmos gestos também acontecem à toa: os bots fazem de vez em quando e qualquer jogador
pode fazer um "Gesto à toa" para despistar. Depois de um gesto de adversário aparece o botão **Pega ladrão!**
por 5 s. Se havia malandragem aberta daquela pessoa, ela é desfeita e o time dela perde 2 pontos; se não havia,
quem acusou perde 1 ponto (o placar não fica negativo). Bots trapaceiam conforme o quanto blefam e denunciam
conforme o quanto são agressivos. Tudo é decidido no servidor (`packages/engine/src/rules/cheats.ts`); o
cliente só pede. O servidor manda os gestos separados do estado do jogo e não manda atualização a quem não
teve nada mudado, para uma malandragem escondida não se entregar pelo tráfego.

**Carta em destaque:** a carta que acabou de ser jogada aparece grande no canto superior esquerdo, com o nome
de quem jogou. No começo da mão a vira (ou a muestra) aparece grande ali com a manilha e depois fica pequena.

**Cena 3D:** câmera só em primeira pessoa, com olhar em volta (arrastar o mouse ou o dedo, giroscópio opcional);
três cenários (boteco, galpão gaúcho, bar); cartas com animação; seis personagens do elenco com animações
(pensar, jogar, bater na mesa no truco, comemorar, lamentar) e sinais faciais do truco gaudério.

**Online:** partida rápida, sala privada com código e link de convite, bots de três níveis, reconexão no mesmo
lugar (o bot assume depois de 30 s), espectadores, chat com filtro e frases prontas, cronômetro por jogada.

**Contas:** convidado ou e-mail e senha; estatísticas por modo, ELO, ranking, XP e conquistas.
Cada partida fica salva com a seed e a lista de ações.

**Acessibilidade e desempenho:** três níveis de qualidade gráfica, tamanho do texto, naipes em quatro cores,
campo de visão ajustável e layout para celular deitado.

## Limitações conhecidas

- **Personagens:** são feitos de formas simples em código, não modelos GLB com animações do Mixamo.
  O sistema de animação já existe; trocar por modelos é uma melhoria futura (ver `CREDITS.md`).
- **Áudio:** sons e música são gerados pela Web Audio API e as falas usam a voz do navegador.
  Não há Howler.js nem vozes gravadas.
- **Tutorial:** é um passo a passo explicativo por modo, com botão para praticar contra um bot fácil.
  Não é um tutorial guiado dentro da partida.
- **Truc Valenciano:** regras aproximadas (22 cartas, envit, Joc Fora). Confirme com quem joga antes de confiar.
- **Regras simplificadas:** o envido é resolvido na hora mostrando os pontos dos dois times; a flor contra flor
  tem valores fixos; no pica-pica não há limite de pontos por duelo.
- **Jogar carta:** é por clique (não por arrastar).
- **Replay:** as partidas ficam gravadas no banco, mas ainda não há tela para assistir.
- **Testes do cliente:** a interface foi conferida num navegador automatizado (partidas completas, dois
  jogadores online, espectador, celular), mas não há testes automáticos do cliente no repositório.
- **Desempenho:** não foi medido em celulares reais.
- **Docker:** o `Dockerfile` foi escrito mas não foi testado.

## Publicar na internet

O jeito mais simples é um serviço que rode Node.js com WebSocket (Railway, Render, Fly.io ou uma VPS):

1. Defina as variáveis `JWT_SECRET` (texto longo e aleatório), `DATABASE_URL` e `PORT`.
2. Rode `pnpm install`, `pnpm build` e `pnpm --filter @truco/server db:push`.
3. Inicie com `pnpm start`. O servidor entrega o jogo, a API e o socket na mesma porta.

Com Docker: `docker build -t truco .` e `docker run -p 3001:3001 -v truco-dados:/data -e JWT_SECRET=... truco`.

Para muitos jogadores, troque o SQLite por PostgreSQL: mude o `provider` em `apps/server/prisma/schema.prisma`
e a `DATABASE_URL`. As salas ficam na memória do servidor, então use uma única instância.

## Poker 3D (Texas Hold'em)

`poker-3d.html` é um jogo à parte, em um único arquivo: abra direto no navegador (precisa de internet só para
carregar o Three.js). Você joga Texas Hold'em em primeira pessoa contra 1 a 4 bots, com um juiz 3D que embaralha, distribui e anuncia
as jogadas, fichas por valor, potes paralelos, blinds que dobram a cada 10 mãos e sons feitos com Web Audio.
