import { useFrame } from '@react-three/fiber';
import type { AvatarConfig, Card } from '@truco/shared';
import { useMemo, useRef } from 'react';
import { MathUtils, type Group, type Mesh } from 'three';
import { Card3D } from '../cards/Card3D';
import type { Anim, Head, SignalShown } from '../store/game';

interface Props {
  avatar: AvatarConfig;
  anim?: Anim;
  signal?: SignalShown;
  /** Para onde a cabeça olha (radianos): yaw positivo = esquerda, pitch positivo = cima. */
  look?: Head;
  /** Pose de "pensando" enquanto é a vez do personagem. */
  thinking?: boolean;
  cardCount?: number;
  /** Cartas mostradas de frente para a mesa (parceiro na mão de onze). */
  shownCards?: Card[];
  spanish?: boolean;
}

const REST_SHOULDER = -0.6;
const REST_ELBOW = -1.3;
const lerp = MathUtils.lerp;

function Hat({ kind }: { kind: AvatarConfig['hat'] }) {
  if (kind === 'palha') {
    return (
      <group position={[0, 0.085, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.115, 0.136, 0.1, 12]} />
          <meshStandardMaterial color="#d8b25a" flatShading />
        </mesh>
        <mesh position={[0, -0.04, 0]} castShadow>
          <cylinderGeometry args={[0.215, 0.225, 0.012, 16]} />
          <meshStandardMaterial color="#e2c06c" flatShading />
        </mesh>
      </group>
    );
  }
  if (kind === 'gaucho') {
    return (
      <group position={[0, 0.09, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.125, 0.136, 0.075, 12]} />
          <meshStandardMaterial color="#2a211b" flatShading />
        </mesh>
        <mesh position={[0, -0.03, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.01, 16]} />
          <meshStandardMaterial color="#2a211b" flatShading />
        </mesh>
      </group>
    );
  }
  if (kind === 'bone') {
    return (
      <group position={[0, 0.035, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.132, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#c0392b" flatShading />
        </mesh>
        <mesh position={[0, 0.012, 0.15]} rotation={[0.15, 0, 0]}>
          <boxGeometry args={[0.15, 0.012, 0.1]} />
          <meshStandardMaterial color="#8e2a20" flatShading />
        </mesh>
      </group>
    );
  }
  if (kind === 'boina') {
    return (
      <mesh position={[0.015, 0.1, 0]} scale={[1.25, 0.32, 1.25]} castShadow>
        <sphereGeometry args={[0.12, 14, 10]} />
        <meshStandardMaterial color="#39424e" flatShading />
      </mesh>
    );
  }
  return null;
}

/** Personagem low-poly feito de formas simples, com animações calculadas quadro a quadro. */
export function Character({ avatar, anim, signal, look, thinking, cardCount = 0, shownCards, spanish = false }: Props) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const rShoulder = useRef<Group>(null);
  const rElbow = useRef<Group>(null);
  const lShoulder = useRef<Group>(null);
  const lElbow = useRef<Group>(null);
  const eyeL = useRef<Mesh>(null);
  const eyeR = useRef<Mesh>(null);
  const brows = useRef<Group>(null);
  const mouth = useRef<Mesh>(null);
  const tongue = useRef<Mesh>(null);
  const cheek = useRef<Mesh>(null);
  // Cada personagem respira e pisca num ritmo um pouco diferente.
  const phase = useMemo(() => Math.random() * 10, []);

  useFrame(({ clock }, delta) => {
    const now = Date.now();
    const time = clock.elapsedTime + phase;
    const t = anim ? (now - anim.at) / 1000 : 99;
    let rs = REST_SHOULDER;
    let re = REST_ELBOW;
    let ls = REST_SHOULDER;
    let le = REST_ELBOW;
    let rise = 0;
    let lean = 0;
    let headPitch = 0;
    let headYaw = 0;
    let headTilt = 0;

    if (anim?.name === 'jogar' && t < 0.7) {
      const k = Math.sin((Math.PI * t) / 0.7);
      rs = lerp(REST_SHOULDER, -1.35, k);
      re = lerp(REST_ELBOW, -0.25, k);
    } else if (anim?.name === 'truco' && t < 1.4) {
      // Levanta o braço, se ergue da cadeira e bate na mesa.
      const whole = Math.sin(Math.PI * Math.min(1, t / 1.4));
      rise = 0.14 * whole;
      lean = 0.24 * whole;
      if (t < 0.28) {
        rs = lerp(REST_SHOULDER, -2.7, t / 0.28);
        re = lerp(REST_ELBOW, -0.4, t / 0.28);
      } else {
        const slam = Math.min(1, (t - 0.28) / 0.07);
        rs = lerp(-2.7, -1.05, slam);
        re = lerp(-0.4, -0.6, slam);
      }
    } else if (anim?.name === 'festa' && t < 2.4) {
      rs = ls = -2.75 + Math.sin(t * 14) * 0.18;
      re = le = -0.3;
      rise = Math.abs(Math.sin(t * 9)) * 0.05;
    } else if (anim?.name === 'triste' && t < 2.4) {
      headPitch = 0.45;
      lean = 0.12;
    } else if (anim?.name === 'gesto' && t < 1.1) {
      // Gestos rápidos: podem ser malandragem ou só manha. A curva sobe e desce em 1,1 s.
      const k = Math.sin(Math.PI * Math.min(1, t / 1.1));
      if (anim.gesture === 'nariz') {
        rs = lerp(REST_SHOULDER, -2.35, k);
        re = lerp(REST_ELBOW, -2.25, k);
        headPitch = 0.08 * k;
      } else if (anim.gesture === 'chapeu') {
        rs = lerp(REST_SHOULDER, -2.95, k);
        re = lerp(REST_ELBOW, -1.5, k);
        headTilt = 0.1 * k;
      } else if (anim.gesture === 'tosse') {
        ls = lerp(REST_SHOULDER, -2.25, k);
        le = lerp(REST_ELBOW, -2.35, k);
        headPitch = 0.25 * k;
        lean = 0.08 * k;
      } else if (anim.gesture === 'espreguicar') {
        rs = ls = lerp(REST_SHOULDER, -2.95, k);
        re = le = lerp(REST_ELBOW, -0.4, k);
        lean = -0.12 * k;
      } else {
        // Olhar para o lado e se inclinar um pouco, como quem espia.
        headYaw = 0.7 * k;
        lean = 0.14 * k;
        headTilt = -0.12 * k;
      }
    } else if (anim?.name === 'sim' && t < 0.9) {
      headPitch = Math.sin(t * 14) * 0.18;
    } else if (anim?.name === 'nao' && t < 0.9) {
      headYaw = Math.sin(t * 14) * 0.3;
    } else if (thinking) {
      rs = -1.0;
      re = -2.25;
      headTilt = 0.12;
      headPitch = 0.08;
    }

    const k = 1 - Math.exp(-delta * 14);
    const damp = (g: Group | null, x: number): void => {
      if (g) g.rotation.x = lerp(g.rotation.x, x, k);
    };
    damp(rShoulder.current, rs);
    damp(rElbow.current, re);
    damp(lShoulder.current, ls);
    damp(lElbow.current, le);
    if (body.current) {
      const breath = Math.sin(time * 1.6) * 0.006;
      body.current.position.y = lerp(body.current.position.y, rise + breath, k);
      body.current.rotation.x = lerp(body.current.rotation.x, lean, k);
      body.current.rotation.z = Math.sin(time * 0.7) * 0.012;
    }
    if (head.current) {
      head.current.rotation.x = lerp(head.current.rotation.x, -(look?.pitch ?? 0) + headPitch, k * 0.6);
      head.current.rotation.y = lerp(head.current.rotation.y, (look?.yaw ?? 0) + headYaw, k * 0.6);
      head.current.rotation.z = lerp(head.current.rotation.z, headTilt, k);
    }

    // Rosto: piscar natural e sinais do truco gaudério.
    const active = signal && now - signal.at < 1400 ? signal.signal : null;
    const blink = time % 4.2 < 0.12 ? 0.1 : 1;
    if (eyeL.current) eyeL.current.scale.y = blink;
    if (eyeR.current) eyeR.current.scale.y = active === 'piscar' ? 0.1 : blink;
    if (brows.current) brows.current.position.y = lerp(brows.current.position.y, active === 'sobrancelha' ? 0.028 : 0, k);
    if (mouth.current) {
      mouth.current.scale.x = lerp(mouth.current.scale.x, active === 'labio' ? 0.45 : 1, k);
      mouth.current.position.x = lerp(mouth.current.position.x, active === 'labio' ? 0.012 : 0, k);
    }
    if (tongue.current) tongue.current.visible = active === 'lingua';
    if (cheek.current) cheek.current.scale.setScalar(lerp(cheek.current.scale.x, active === 'bochecha' ? 1.9 : 0.6, k));
  });

  const skin = <meshStandardMaterial color={avatar.skin} flatShading />;
  const shirt = <meshStandardMaterial color={avatar.shirt} flatShading />;
  const cards = shownCards ?? Array.from({ length: cardCount }, () => null);

  const arm = (side: 1 | -1, shoulder: typeof rShoulder, elbow: typeof rElbow) => (
    <group ref={shoulder} position={[side * -0.21, 0.98, 0.02]} rotation={[REST_SHOULDER, 0, side * 0.12]}>
      <mesh position={[0, -0.13, 0]} castShadow>
        <capsuleGeometry args={[0.048, 0.2, 3, 8]} />
        {shirt}
      </mesh>
      <group ref={elbow} position={[0, -0.27, 0]} rotation={[REST_ELBOW, 0, 0]}>
        <mesh position={[0, -0.12, 0]} castShadow>
          <capsuleGeometry args={[0.04, 0.2, 3, 8]} />
          {shirt}
        </mesh>
        <mesh position={[0, -0.27, 0]} castShadow>
          <sphereGeometry args={[0.05, 8, 6]} />
          {skin}
        </mesh>
      </group>
    </group>
  );

  return (
    <group>
      {/* Pernas debaixo da mesa */}
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, 0.5, 0.2]} castShadow>
          <boxGeometry args={[0.14, 0.13, 0.45]} />
          <meshStandardMaterial color="#3a3f4a" flatShading />
        </mesh>
      ))}
      <group ref={body}>
        <mesh position={[0, 0.76, 0]} scale={[1, 1, 0.68]} castShadow>
          <capsuleGeometry args={[0.2, 0.26, 4, 10]} />
          {shirt}
        </mesh>
        <mesh position={[0, 1.04, 0]}>
          <cylinderGeometry args={[0.05, 0.06, 0.08, 8]} />
          {skin}
        </mesh>
        {arm(1, rShoulder, rElbow)}
        {arm(-1, lShoulder, lElbow)}

        <group ref={head} position={[0, 1.17, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.125, 14, 12]} />
            {skin}
          </mesh>
          <mesh position={[0, 0.03, -0.022]} rotation={[-0.5, 0, 0]}>
            <sphereGeometry args={[0.132, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.9]} />
            <meshStandardMaterial color={avatar.hair} flatShading />
          </mesh>
          <Hat kind={avatar.hat} />
          <mesh ref={eyeL} position={[0.045, 0.015, 0.113]}>
            <sphereGeometry args={[0.016, 8, 6]} />
            <meshStandardMaterial color="#1a1410" />
          </mesh>
          <mesh ref={eyeR} position={[-0.045, 0.015, 0.113]}>
            <sphereGeometry args={[0.016, 8, 6]} />
            <meshStandardMaterial color="#1a1410" />
          </mesh>
          <group ref={brows}>
            {[0.045, -0.045].map((x) => (
              <mesh key={x} position={[x, 0.048, 0.116]} rotation={[0, 0, x > 0 ? -0.12 : 0.12]}>
                <boxGeometry args={[0.042, 0.009, 0.01]} />
                <meshStandardMaterial color={avatar.hair} />
              </mesh>
            ))}
          </group>
          <mesh position={[0, -0.012, 0.128]}>
            <sphereGeometry args={[0.017, 6, 5]} />
            {skin}
          </mesh>
          <mesh ref={mouth} position={[0, -0.058, 0.108]}>
            <boxGeometry args={[0.05, 0.011, 0.012]} />
            <meshStandardMaterial color="#6e2f2a" />
          </mesh>
          <mesh ref={tongue} position={[0, -0.072, 0.114]} visible={false}>
            <boxGeometry args={[0.024, 0.024, 0.012]} />
            <meshStandardMaterial color="#e06a7c" />
          </mesh>
          <mesh ref={cheek} position={[-0.078, -0.03, 0.08]} scale={0.6}>
            <sphereGeometry args={[0.03, 8, 6]} />
            {skin}
          </mesh>
          {avatar.mustache && (
            <mesh position={[0, -0.04, 0.118]}>
              <boxGeometry args={[0.075, 0.016, 0.014]} />
              <meshStandardMaterial color={avatar.hair} />
            </mesh>
          )}
          {avatar.glasses &&
            [0.045, -0.045].map((x) => (
              <mesh key={x} position={[x, 0.015, 0.122]}>
                <torusGeometry args={[0.026, 0.004, 6, 14]} />
                <meshStandardMaterial color="#222" />
              </mesh>
            ))}
        </group>

        {/* Cartas na mão esquerda: os outros só veem o verso. */}
        <group position={[0.13, 0.9, 0.34]} rotation={[-0.2, 0, 0]}>
          {cards.map((card, i) => {
            const offset = i - (cards.length - 1) / 2;
            return (
              <Card3D
                key={card?.id ?? i}
                card={card}
                spanish={spanish}
                scale={0.72}
                position={[offset * 0.045, -Math.abs(offset) * 0.006, i * 0.002]}
                rotation={[0, 0, -offset * 0.18]}
              />
            );
          })}
        </group>
      </group>
    </group>
  );
}
