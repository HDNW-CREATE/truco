import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { DepthOfField, EffectComposer } from '@react-three/postprocessing';
import type { Action, PlayerView, SpectatorView } from '@truco/shared';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, Vector3, type Group, type PerspectiveCamera } from 'three';
import { Card3D } from '../cards/Card3D';
import { Character } from '../characters/Character';
import { isPlayerView, net, seatOf, useGame, type Head } from '../store/game';
import { useSettings } from '../store/settings';
import { anchors } from './anchors';
import { Environment } from './Environment';
import { EYE_HEIGHT, relativeSeat, SEAT_RADIUS, seatAngle, TABLE_HEIGHT, towardSeat } from './layout';

type View = PlayerView | SpectatorView;
const BASE_PITCH = -0.33;
const MAX_YAW = MathUtils.degToRad(70);
const MAX_UP = MathUtils.degToRad(20);
const MAX_DOWN = MathUtils.degToRad(40);
const clamp = MathUtils.clamp;

/** Ângulo para a câmera (ou a cabeça) olhar da cadeira "from" para a cadeira "to". */
function yawBetween(from: number, to: number): number {
  const a = towardSeat(from, SEAT_RADIUS, 0);
  const b = towardSeat(to, SEAT_RADIUS, 0);
  // Direção no referencial de quem está sentado em "from", olhando para o centro.
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const cos = Math.cos(-(from + Math.PI));
  const sin = Math.sin(-(from + Math.PI));
  return Math.atan2(dx * cos + dz * sin, -dx * sin + dz * cos);
}

/** Câmera em primeira pessoa: fica na cadeira do jogador e gira com o arrastar do mouse ou do dedo. */
function FirstPerson({ spectator }: { spectator: boolean }) {
  const { camera, gl } = useThree();
  const look = useRef({ yaw: 0, pitch: 0, lastMove: 0, sentYaw: 0, sentPitch: 0, sentAt: 0 });
  const speakerSeen = useRef<number | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent): void => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const move = (e: PointerEvent): void => {
      if (!dragging) return;
      const s = look.current;
      s.yaw = clamp(s.yaw + (e.clientX - lastX) * 0.004, -MAX_YAW, MAX_YAW);
      s.pitch = clamp(s.pitch + (e.clientY - lastY) * 0.004, -MAX_DOWN, MAX_UP);
      s.lastMove = Date.now();
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (): void => {
      dragging = false;
    };
    // Giroscópio (opcional): inclinar o celular move a visão.
    let base: { beta: number; gamma: number } | null = null;
    const tilt = (e: DeviceOrientationEvent): void => {
      if (!useSettings.getState().gyro || e.beta === null || e.gamma === null) return;
      base ??= { beta: e.beta, gamma: e.gamma };
      const s = look.current;
      s.yaw = clamp(MathUtils.degToRad(base.gamma - e.gamma) * 1.5, -MAX_YAW, MAX_YAW);
      s.pitch = clamp(MathUtils.degToRad(e.beta - base.beta), -MAX_DOWN, MAX_UP);
      s.lastMove = Date.now();
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('deviceorientation', tilt);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('deviceorientation', tilt);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const s = look.current;
    const now = Date.now();
    const settings = useSettings.getState();
    const game = useGame.getState();
    const cam = camera as PerspectiveCamera;

    // Opcional: virar a cabeça sozinho para quem acabou de cantar.
    if (settings.autoLook && game.speaker !== speakerSeen.current) {
      speakerSeen.current = game.speaker;
      const total = game.view?.players.length ?? 4;
      const mine = game.room?.yourSeat ?? game.spectateSeat;
      if (game.speaker !== null && game.speaker !== mine) {
        const angle = seatAngle(relativeSeat(game.speaker, mine, total), total);
        s.yaw = clamp(yawBetween(0, angle), -MAX_YAW, MAX_YAW);
        s.lastMove = now;
      }
    }
    if (settings.autoRecenter && !settings.gyro && now - s.lastMove > 3000) {
      const k = 1 - Math.exp(-delta * 3);
      s.yaw = MathUtils.lerp(s.yaw, 0, k);
      s.pitch = MathUtils.lerp(s.pitch, 0, k);
    }

    // Tremor leve quando alguém bate na mesa.
    const since = now - game.shakeAt;
    const shake = since >= 0 && since < 450 ? (1 - since / 450) * 0.018 : 0;
    cam.position.set(0, EYE_HEIGHT + (spectator ? 0.62 : 0), SEAT_RADIUS + (spectator ? 0.75 : 0.02));
    cam.rotation.order = 'YXZ';
    cam.rotation.set(
      BASE_PITCH - (spectator ? 0.2 : 0) + s.pitch + (Math.random() - 0.5) * shake,
      s.yaw + (Math.random() - 0.5) * shake,
      0,
    );
    if (cam.fov !== settings.fov) {
      cam.fov = settings.fov;
      cam.updateProjectionMatrix();
    }

    // Envia o giro da cabeça umas 10 vezes por segundo, só quando muda.
    if (
      !spectator &&
      now - s.sentAt > 100 &&
      (Math.abs(s.yaw - s.sentYaw) > 0.02 || Math.abs(s.pitch - s.sentPitch) > 0.02)
    ) {
      s.sentAt = now;
      s.sentYaw = s.yaw;
      s.sentPitch = s.pitch;
      net.head(s.yaw, s.pitch);
    }
  });
  return null;
}

/** Braços do próprio jogador, vistos de cima; o direito bate na mesa no truco. */
function MyArms({ seat }: { seat: number }) {
  const avatar = useSettings((s) => s.avatar);
  const right = useRef<Group>(null);
  useFrame((_, delta) => {
    const anim = useGame.getState().anims[seat];
    const t = anim ? (Date.now() - anim.at) / 1000 : 99;
    let lift = 0;
    let reach = 0;
    if (anim?.name === 'truco' && t < 1.2) lift = t < 0.28 ? (t / 0.28) * 0.3 : Math.max(0, 0.3 - (t - 0.28) * 4.5);
    if (anim?.name === 'jogar' && t < 0.6) reach = Math.sin((Math.PI * t) / 0.6) * 0.25;
    if (right.current) {
      const k = 1 - Math.exp(-delta * 18);
      right.current.position.y = MathUtils.lerp(right.current.position.y, lift, k);
      right.current.position.z = MathUtils.lerp(right.current.position.z, -reach, k);
    }
  });
  const arm = (x: number) => (
    <group>
      <mesh position={[x * 1.35, 0.86, SEAT_RADIUS - 0.2]} rotation={[1.25, 0, x * 1.6]}>
        <capsuleGeometry args={[0.042, 0.3, 3, 8]} />
        <meshStandardMaterial color={avatar.shirt} flatShading />
      </mesh>
      <mesh position={[x, 0.83, SEAT_RADIUS - 0.38]}>
        <sphereGeometry args={[0.042, 8, 6]} />
        <meshStandardMaterial color={avatar.skin} flatShading />
      </mesh>
    </group>
  );
  return (
    <group>
      {arm(-0.2)}
      <group ref={right}>{arm(0.2)}</group>
    </group>
  );
}

/** As cartas na mão do jogador, em leque na parte de baixo da visão. */
function MyHand({ view }: { view: PlayerView }) {
  const cover = useGame((s) => s.cover);
  const spanish = view.config.deck.kind === 'espanhol';
  const count = view.cardCounts[view.me] ?? 0;
  const cards = view.myCards ?? Array.from({ length: count }, () => null);
  const plays = view.legalActions.filter(
    (a): a is Extract<Action, { type: 'JOGAR_CARTA' }> => a.type === 'JOGAR_CARTA',
  );

  return (
    <>
      {cards.map((card, i) => {
        const id = card?.id ?? `oculta-${i}`;
        const open = plays.find((a) => a.cardId === id && !a.faceDown);
        const hidden = plays.find((a) => a.cardId === id && a.faceDown);
        const action = cover && hidden ? hidden : open;
        const offset = i - (cards.length - 1) / 2;
        return (
          <Card3D
            key={`${view.handNumber}-${id}`}
            card={card}
            spanish={spanish}
            from={[0, TABLE_HEIGHT + 0.05, 0]}
            position={[offset * 0.108, 0.955 - Math.abs(offset) * 0.008, SEAT_RADIUS - 0.4 + i * 0.002]}
            rotation={[-0.66, 0, -offset * 0.11]}
            dim={!action}
            onClick={action ? () => net.act(action) : undefined}
          />
        );
      })}
    </>
  );
}

/** Cartas jogadas, vira ou muestra e o baralho no centro da mesa. */
function TableCards({ view, mySeat }: { view: View; mySeat: number }) {
  const total = view.players.length;
  const spanish = view.config.deck.kind === 'espanhol';
  const y = TABLE_HEIGHT + 0.012;
  return (
    <>
      {view.tricks.flatMap((trick, t) =>
        trick.plays.map((play, order) => {
          const angle = seatAngle(relativeSeat(seatOf(play.playerId), mySeat, total), total);
          const [x, , z] = towardSeat(angle, 0.24 + t * 0.17, 0);
          const jitter = ((seatOf(play.playerId) * 7 + t * 3) % 5) * 0.05 - 0.1;
          return (
            <Card3D
              key={`${view.handNumber}-${t}-${play.playerId}`}
              card={play.card}
              spanish={spanish}
              scale={1.5}
              from={towardSeat(angle, SEAT_RADIUS - 0.35, 0.95)}
              position={[x, y + order * 0.002 + t * 0.001, z]}
              rotation={play.faceDown ? [Math.PI / 2, 0, -angle + jitter] : [-Math.PI / 2, 0, angle + jitter]}
            />
          );
        }),
      )}
      {view.turnedCard && (
        <Card3D
          key={`vira-${view.handNumber}`}
          card={view.turnedCard}
          spanish={spanish}
          scale={1.4}
          from={[-0.1, y + 0.05, 0]}
          position={[0.1, y, 0]}
          rotation={[-Math.PI / 2, 0, 0.12]}
        />
      )}
      <DeckPile view={view} mySeat={mySeat} />
    </>
  );
}

const DECK_W = 0.14;
const DECK_D = 0.2;
const HALF_H = 0.014;

/**
 * O baralho. Com embaralhar e cortar ligado ele vai para as mãos do pé (na minha vez, bem na frente
 * da câmera) e as duas metades se intercalam a cada embaralhada; depois desce na frente de quem corta,
 * e a metade de cima sobe e passa para baixo a cada corte. Fora disso fica no centro da mesa.
 */
function DeckPile({ view, mySeat }: { view: View; mySeat: number }) {
  const group = useRef<Group>(null);
  const top = useRef<Group>(null);
  const bottom = useRef<Group>(null);
  const target = useMemo(() => new Vector3(), []);
  const total = view.players.length;
  const prep = view.prep;
  const y = TABLE_HEIGHT + 0.012;

  useFrame((_, delta) => {
    const g = group.current;
    if (!g || !top.current || !bottom.current) return;
    const now = Date.now();
    const { shuffleAt, cutAt } = useGame.getState();
    let yaw = 0.2;
    if (prep && view.phase === 'embaralhando') {
      const seat = seatOf(prep.shuffler);
      const angle = seatAngle(relativeSeat(seat, mySeat, total), total);
      const mine = seat === mySeat;
      target.set(...towardSeat(angle, mine ? SEAT_RADIUS - 0.44 : SEAT_RADIUS - 0.62, mine ? 0.9 : 0.86));
      yaw = angle;
    } else if (prep && view.phase === 'cortando') {
      const angle = seatAngle(relativeSeat(seatOf(prep.cutter), mySeat, total), total);
      target.set(...towardSeat(angle, 0.5, y));
      yaw = angle;
    } else {
      target.set(view.turnedCard ? -0.1 : 0, y, 0);
    }
    const k = 1 - Math.exp(-delta * 6);
    g.position.lerp(target, k);
    g.rotation.y = MathUtils.lerp(g.rotation.y, yaw, k);

    // Embaralhada: as metades se afastam para os lados e voltam intercaladas.
    // Para quem olha outro jogador, o gesto se repete enquanto ele embaralha.
    const shuffling = view.phase === 'embaralhando';
    const sinceShuffle = (now - shuffleAt) / 1000;
    const otherShuffling = shuffling && prep !== null && seatOf(prep.shuffler) !== mySeat;
    const riffleT = otherShuffling ? (now / 650) % 1 : sinceShuffle < 0.65 ? sinceShuffle / 0.65 : 1;
    const spread = Math.sin(Math.PI * riffleT) * 0.07;
    const tilt = Math.sin(Math.PI * riffleT) * 0.35;
    // Corte: a metade de cima sobe, vai para trás e desce embaixo.
    const sinceCut = (now - cutAt) / 1000;
    const cutT = sinceCut < 0.7 ? sinceCut / 0.7 : 1;
    const lift = Math.sin(Math.PI * cutT) * 0.06;
    const slide = Math.sin(Math.PI * cutT) * 0.12;

    top.current.position.set(-spread, HALF_H * 1.5 + lift, -slide);
    top.current.rotation.set(0, 0, tilt);
    bottom.current.position.set(spread, HALF_H * 0.5, 0);
    bottom.current.rotation.set(0, 0, -tilt);
  });

  const half = (color: string) => (
    <mesh castShadow>
      <boxGeometry args={[DECK_W, HALF_H, DECK_D]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
  return (
    <group ref={group} position={[view.turnedCard ? -0.1 : 0, y, 0]}>
      <group ref={bottom}>{half('#7a1f1f')}</group>
      <group ref={top}>{half('#8a2525')}</group>
    </group>
  );
}

/** Marca na tela o ponto acima da cabeça do personagem, para a etiqueta e o balão de fala. */
function Anchor({ seat }: { seat: number }) {
  const ref = useRef<Group>(null);
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    if (!ref.current) return;
    ref.current.getWorldPosition(point).project(camera);
    anchors.set(seat, {
      x: ((point.x + 1) / 2) * size.width,
      y: ((1 - point.y) / 2) * size.height,
      visible: point.z < 1 && Math.abs(point.x) < 1.2,
    });
  });
  useEffect(() => () => void anchors.delete(seat), [seat]);
  return <group ref={ref} position={[0, 1.44, 0]} />;
}

/** Um lugar da mesa: personagem e ponto de ancoragem da etiqueta. */
function Seat({ view, seat, mySeat, showBody }: { view: View; seat: number; mySeat: number; showBody: boolean }) {
  const total = view.players.length;
  const player = view.players.find((p) => p.seat === seat);
  const info = useGame((s) => s.room?.seats[seat]);
  const anim = useGame((s) => s.anims[seat]);
  const signal = useGame((s) => s.signals[seat]);
  const remoteHead = useGame((s) => s.heads[seat]);
  const speaker = useGame((s) => s.speaker);
  const angle = seatAngle(relativeSeat(seat, mySeat, total), total);
  if (!player || !info) return null;

  const isTurn = view.turn === player.id && view.phase === 'jogando';
  const playing = view.active.includes(player.id);
  // Bots e jogadores sem dados de cabeça olham para quem está na vez ou falou por último.
  const target = speaker !== null && speaker !== seat ? speaker : seatOf(view.turn);
  const auto: Head =
    target === seat
      ? { yaw: 0, pitch: -0.28 }
      : { yaw: clamp(yawBetween(angle, seatAngle(relativeSeat(target, mySeat, total), total)), -1.1, 1.1), pitch: -0.05 };
  const look = info.kind === 'humano' && remoteHead ? remoteHead : auto;
  const partner = isPlayerView(view) ? view.partnerCards?.[player.id] : undefined;

  return (
    <group position={towardSeat(angle, SEAT_RADIUS, 0)} rotation={[0, angle + Math.PI, 0]}>
      {showBody && (
        <Character
          avatar={info.avatar}
          anim={anim}
          signal={signal}
          look={look}
          thinking={isTurn && !view.pendingBet}
          cardCount={playing ? (view.cardCounts[player.id] ?? 0) : 0}
          shownCards={partner}
          spanish={view.config.deck.kind === 'espanhol'}
        />
      )}
      {showBody && <Anchor seat={seat} />}
    </group>
  );
}

export function TableScene() {
  const view = useGame((s) => s.view);
  const room = useGame((s) => s.room);
  const spectateSeat = useGame((s) => s.spectateSeat);
  const quality = useSettings((s) => s.quality);
  const fov = useSettings((s) => s.fov);
  const dpr = useMemo((): [number, number] => (quality === 'baixa' ? [1, 1] : quality === 'media' ? [1, 1.5] : [1, 2]), [quality]);
  if (!view || !room) return null;

  const spectator = room.yourSeat === null;
  const mySeat = room.yourSeat ?? spectateSeat;
  return (
    <Canvas
      shadows={quality !== 'baixa'}
      dpr={dpr}
      camera={{ fov, near: 0.05, far: 30, position: [0, EYE_HEIGHT, SEAT_RADIUS] }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={['#120c07']} />
      <FirstPerson spectator={spectator} />
      <Environment scenario={room.settings.scenario} quality={quality} seats={view.players.length} seatRadius={SEAT_RADIUS} />
      {view.players.map((p) => (
        <Seat key={p.id} view={view} seat={p.seat} mySeat={mySeat} showBody={spectator || p.seat !== mySeat} />
      ))}
      <TableCards view={view} mySeat={mySeat} />
      {isPlayerView(view) && !spectator && (
        <>
          <MyArms seat={mySeat} />
          <MyHand view={view} />
        </>
      )}
      {quality === 'alta' && (
        <EffectComposer>
          {/* Mesa e jogadores nítidos; só o fundo da sala desfoca. */}
          <DepthOfField worldFocusDistance={1.3} worldFocusRange={3.2} bokehScale={1.6} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
