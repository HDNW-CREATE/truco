import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import type { Card } from '@truco/shared';
import { useMemo, useRef, useState } from 'react';
import { Euler, MathUtils, Quaternion, Vector3, type Group } from 'three';
import { useSettings } from '../store/settings';
import { cardTexture } from './textures';

export const CARD_W = 0.1;
export const CARD_H = 0.144;

type Triple = [number, number, number];

interface Props {
  /** null = carta desconhecida (mostra o verso dos dois lados). */
  card: Card | null;
  spanish: boolean;
  position: Triple;
  rotation: Triple;
  /** De onde a carta sai quando aparece (ex.: da mão de quem jogou). */
  from?: Triple;
  scale?: number;
  dim?: boolean;
  onClick?: () => void;
}

/** Uma carta com espessura, frente e verso, que desliza até a posição de destino. */
export function Card3D({ card, spanish, position, rotation, from, scale = 1, dim, onClick }: Props) {
  const group = useRef<Group>(null);
  const colorblind = useSettings((s) => s.colorblind);
  const [hover, setHover] = useState(false);
  const front = useMemo(() => cardTexture(card, spanish, colorblind), [card, spanish, colorblind]);
  const back = useMemo(() => cardTexture(null, spanish, colorblind), [spanish, colorblind]);
  const target = useMemo(() => new Vector3(), []);
  const targetQuat = useMemo(() => new Quaternion(), []);
  const euler = useMemo(() => new Euler(), []);
  const started = useRef(false);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    target.set(position[0], position[1] + (hover && onClick ? 0.025 : 0), position[2]);
    targetQuat.setFromEuler(euler.set(rotation[0], rotation[1], rotation[2]));
    if (!started.current) {
      started.current = true;
      g.position.set(...(from ?? position));
      g.quaternion.copy(targetQuat);
    }
    const k = 1 - Math.exp(-delta * 9);
    g.position.lerp(target, k);
    g.quaternion.slerp(targetQuat, k);
    g.scale.setScalar(MathUtils.lerp(g.scale.x, scale * (hover && onClick ? 1.08 : 1), k));
  });

  const click = (e: ThreeEvent<MouseEvent>): void => {
    // Arrastar para olhar em volta não conta como clique.
    if (!onClick || e.delta > 6) return;
    e.stopPropagation();
    onClick();
  };
  const tint = dim ? '#b9b9b9' : '#ffffff';

  return (
    <group ref={group}>
      <mesh
        castShadow
        onClick={click}
        onPointerOver={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <boxGeometry args={[CARD_W, CARD_H, 0.0016]} />
        <meshStandardMaterial attach="material-0" color="#e9e4d6" />
        <meshStandardMaterial attach="material-1" color="#e9e4d6" />
        <meshStandardMaterial attach="material-2" color="#e9e4d6" />
        <meshStandardMaterial attach="material-3" color="#e9e4d6" />
        <meshStandardMaterial
          attach="material-4"
          map={front}
          color={tint}
          roughness={0.55}
          emissive={hover && onClick ? '#ffcc55' : '#000000'}
          emissiveIntensity={0.18}
        />
        <meshStandardMaterial attach="material-5" map={back} color={tint} roughness={0.55} />
      </mesh>
    </group>
  );
}
