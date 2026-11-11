import { useFrame } from '@react-three/fiber';
import type { Scenario } from '@truco/shared';
import { useMemo, useRef } from 'react';
import { BackSide, CanvasTexture, RepeatWrapping, SRGBColorSpace, type Group, type PointLight } from 'three';
import type { Quality } from '../store/settings';
import { TABLE_HEIGHT, TABLE_RADIUS, towardSeat } from './layout';

interface Look {
  wall: string;
  floor: string;
  cloth: string;
  light: string;
  ambient: number;
}

const LOOKS: Record<Scenario, Look> = {
  boteco: { wall: '#8a6a45', floor: '#4a3524', cloth: '#b3261e', light: '#ffd9a0', ambient: 0.55 },
  galpao: { wall: '#5a4330', floor: '#3a2a1c', cloth: '#5b3a22', light: '#ffb873', ambient: 0.45 },
  bar: { wall: '#2b3445', floor: '#2a2226', cloth: '#1f6b42', light: '#ffe6c0', ambient: 0.5 },
};

/** Toalha xadrez do boteco, desenhada em canvas. */
function checkered(): CanvasTexture {
  const el = document.createElement('canvas');
  el.width = el.height = 64;
  const g = el.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#f3ead8';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(179,38,30,0.75)';
  g.fillRect(0, 0, 32, 64);
  g.fillRect(0, 0, 64, 32);
  const texture = new CanvasTexture(el);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(9, 9);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function Mug({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.045, 0]}>
        <cylinderGeometry args={[0.035, 0.03, 0.09, 12]} />
        <meshStandardMaterial color="#e8e2d0" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.085, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.006, 12]} />
        <meshStandardMaterial color="#d99a2b" />
      </mesh>
    </group>
  );
}

/** Cuia de chimarrão com a bomba. */
function Mate({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#5a3518" flatShading />
      </mesh>
      <mesh position={[0, 0.075, 0]}>
        <cylinderGeometry args={[0.03, 0.035, 0.012, 10]} />
        <meshStandardMaterial color="#5f7d2a" />
      </mesh>
      <mesh position={[0.012, 0.11, 0]} rotation={[0, 0, -0.35]}>
        <cylinderGeometry args={[0.004, 0.004, 0.12, 6]} />
        <meshStandardMaterial color="#c9c9c9" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Chair({ angle, radius }: { angle: number; radius: number }) {
  return (
    <group position={towardSeat(angle, radius, 0)} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, 0.43, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.44, 0.05, 0.42]} />
        <meshStandardMaterial color="#6b4423" flatShading />
      </mesh>
      <mesh position={[0, 0.78, -0.2]} castShadow>
        <boxGeometry args={[0.44, 0.55, 0.045]} />
        <meshStandardMaterial color="#6b4423" flatShading />
      </mesh>
      {[
        [-0.19, -0.18],
        [0.19, -0.18],
        [-0.19, 0.18],
        [0.19, 0.18],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x as number, 0.21, z as number]}>
          <boxGeometry args={[0.04, 0.42, 0.04]} />
          <meshStandardMaterial color="#553318" />
        </mesh>
      ))}
    </group>
  );
}

interface Props {
  scenario: Scenario;
  quality: Quality;
  seats: number;
  seatRadius: number;
}

/** Sala, mesa, cadeiras, luzes e enfeites de cada cenário. */
export function Environment({ scenario, quality, seats, seatRadius }: Props) {
  const look = LOOKS[scenario];
  const lamp = useRef<Group>(null);
  const fire = useRef<PointLight>(null);
  const cloth = useMemo(() => (scenario === 'boteco' ? checkered() : null), [scenario]);
  const shadows = quality !== 'baixa';
  const between = (i: number): number => ((i + 0.5) * 2 * Math.PI) / seats;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (lamp.current) lamp.current.rotation.z = Math.sin(t * 0.9) * 0.035;
    if (fire.current) fire.current.intensity = 9 + Math.sin(t * 11) * 1.6 + Math.sin(t * 23) * 0.9;
  });

  return (
    <group>
      <ambientLight intensity={look.ambient} />
      <hemisphereLight args={['#fff1d6', '#2a1c10', 0.5]} />
      <directionalLight position={[2, 4, 3]} intensity={0.55} />

      {/* Sala */}
      <mesh position={[0, 1.7, 0]}>
        <boxGeometry args={[9, 3.4, 9]} />
        <meshStandardMaterial color={look.wall} side={BackSide} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[9, 9]} />
        <meshStandardMaterial color={look.floor} roughness={0.9} />
      </mesh>

      {/* Luminária pendurada, balançando de leve */}
      <group ref={lamp} position={[0, 3.4, 0]}>
        <mesh position={[0, -0.65, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 1.3, 6]} />
          <meshStandardMaterial color="#222" />
        </mesh>
        <mesh position={[0, -1.32, 0]}>
          <coneGeometry args={[0.26, 0.2, 14, 1, true]} />
          <meshStandardMaterial color="#3b3b3b" side={2} />
        </mesh>
        <mesh position={[0, -1.4, 0]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color="#fff" emissive={look.light} emissiveIntensity={3} />
        </mesh>
        <pointLight
          position={[0, -1.45, 0]}
          color={look.light}
          intensity={11}
          distance={9}
          decay={1.6}
          castShadow={shadows}
          shadow-mapSize={quality === 'alta' ? [2048, 2048] : [1024, 1024]}
          shadow-bias={-0.002}
        />
      </group>

      {/* Mesa */}
      <mesh position={[0, TABLE_HEIGHT - 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.06, 40]} />
        <meshStandardMaterial color="#7a4e2a" roughness={0.6} />
      </mesh>
      <mesh position={[0, TABLE_HEIGHT + 0.002, 0]} receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS - 0.09, TABLE_RADIUS - 0.09, 0.006, 40]} />
        <meshStandardMaterial color={cloth ? '#ffffff' : look.cloth} map={cloth} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.37, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, 0.72, 12]} />
        <meshStandardMaterial color="#5d3a1e" />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.4, 0.45, 0.04, 16]} />
        <meshStandardMaterial color="#5d3a1e" />
      </mesh>

      {Array.from({ length: seats }, (_, i) => (
        <Chair key={i} angle={(i * 2 * Math.PI) / seats} radius={seatRadius + 0.05} />
      ))}

      {/* Enfeites na mesa, entre os lugares, para não atrapalhar as cartas */}
      {Array.from({ length: seats }, (_, i) =>
        scenario === 'galpao' && i === 0 ? (
          <Mate key={i} position={towardSeat(between(i), TABLE_RADIUS - 0.17, TABLE_HEIGHT + 0.005)} />
        ) : (
          <Mug key={i} position={towardSeat(between(i), TABLE_RADIUS - 0.17, TABLE_HEIGHT + 0.005)} />
        ),
      )}
      <group position={towardSeat(between(seats - 1), TABLE_RADIUS - 0.4, TABLE_HEIGHT + 0.005)} scale={0.8}>
        <mesh position={[0, 0.008, 0]} receiveShadow>
          <cylinderGeometry args={[0.11, 0.09, 0.016, 16]} />
          <meshStandardMaterial color="#efe9da" />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.3) * 0.045, 0.03, Math.sin(i * 1.3) * 0.045]}>
            <sphereGeometry args={[0.02, 6, 5]} />
            <meshStandardMaterial color={i % 2 ? '#c98b3a' : '#a8612a'} flatShading />
          </mesh>
        ))}
      </group>

      {/* Parede do fundo de cada cenário */}
      {scenario === 'galpao' && (
        <group position={[0, 0, -4.3]}>
          <mesh position={[0, 0.8, 0]}>
            <boxGeometry args={[1.8, 1.6, 0.4]} />
            <meshStandardMaterial color="#4a4038" flatShading />
          </mesh>
          <mesh position={[0, 0.55, 0.16]}>
            <boxGeometry args={[1.1, 0.8, 0.12]} />
            <meshStandardMaterial color="#1a0d06" emissive="#ff6a1a" emissiveIntensity={1.6} />
          </mesh>
          <pointLight ref={fire} position={[0, 0.7, 0.8]} color="#ff7a2a" intensity={9} distance={8} decay={1.5} />
          <mesh position={[0.5, 1.72, 0.1]}>
            <sphereGeometry args={[0.12, 10, 8]} />
            <meshStandardMaterial color="#2b2b2b" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      )}
      {scenario !== 'galpao' && (
        <group position={[0, 0, -4.35]}>
          {[1.2, 1.75].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <boxGeometry args={[3.4, 0.05, 0.25]} />
              <meshStandardMaterial color="#3d2817" />
            </mesh>
          ))}
          {Array.from({ length: 14 }, (_, i) => (
            <mesh key={i} position={[-1.5 + (i % 7) * 0.5, i < 7 ? 1.37 : 1.92, 0]}>
              <cylinderGeometry args={[0.045, 0.05, 0.3, 8]} />
              <meshStandardMaterial
                color={['#2e6b3a', '#8a4b1c', '#b9a03a', '#3a5a8a'][i % 4]}
                roughness={0.25}
              />
            </mesh>
          ))}
          {scenario === 'bar' && (
            <mesh position={[0, 2.5, 0.05]}>
              <boxGeometry args={[1.6, 0.35, 0.05]} />
              <meshStandardMaterial color="#111" emissive="#ff3b6b" emissiveIntensity={1.8} />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
}
