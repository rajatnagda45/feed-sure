import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, MeshStandardMaterial } from "three";

import { PALETTE, STOPS } from "./route";

/** A cylindrical digester with a domed green roof. */
function Digester({ x, z, r, h }: { x: number; z: number; r: number; h: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 28]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.5} metalness={0.25} />
      </mesh>
      <mesh position={[0, h, 0]} castShadow>
        <sphereGeometry args={[r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={PALETTE.forest} roughness={0.55} metalness={0.15} />
      </mesh>
    </group>
  );
}

/** Stage 4 — the CBG plant: digesters, storage tanks, pipes and a restrained
 *  green glow suggesting a working circular process. */
export function CBGPlant() {
  const glow = useRef<Mesh>(null);
  const flare = useRef<MeshStandardMaterial>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (glow.current) glow.current.scale.setScalar(1 + Math.sin(t * 1.5) * 0.06);
    if (flare.current) flare.current.emissiveIntensity = 1.4 + Math.sin(t * 3) * 0.4;
  });

  return (
    <group position={STOPS.plant}>
      {/* concrete pad */}
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[3.2, 0.06, 2.8]} />
        <meshStandardMaterial color="#d9d8cc" roughness={0.9} />
      </mesh>

      <Digester x={-0.7} z={0.3} r={0.62} h={1.0} />
      <Digester x={0.7} z={-0.2} r={0.74} h={1.25} />

      {/* storage tank */}
      <mesh position={[-1.25, 0.5, -0.8]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 1.0, 20]} />
        <meshStandardMaterial color={PALETTE.metalDark} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[-1.25, 1.0, -0.8]} castShadow>
        <sphereGeometry args={[0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={PALETTE.metalDark} roughness={0.4} metalness={0.4} />
      </mesh>

      {/* connecting pipes with a shimmering green sheen */}
      <mesh position={[0, 0.42, 0.1]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 1.5, 12]} />
        <meshStandardMaterial
          color={PALETTE.sage}
          emissive={PALETTE.lime}
          emissiveIntensity={0.25}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>

      {/* processing stack with a restrained flame */}
      <mesh position={[1.4, 0.7, 0.5]} castShadow>
        <cylinderGeometry args={[0.12, 0.14, 1.4, 16]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh ref={glow} position={[1.4, 1.5, 0.5]}>
        <sphereGeometry args={[0.1, 14, 14]} />
        <meshStandardMaterial
          ref={flare}
          color={PALETTE.lime}
          emissive={PALETTE.lime}
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>

      {/* soft destination glow */}
      <pointLight position={[0, 1.4, 0]} color={PALETTE.lime} intensity={6} distance={5} decay={2} />
    </group>
  );
}
