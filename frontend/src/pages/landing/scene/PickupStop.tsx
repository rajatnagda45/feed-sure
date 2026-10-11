import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh } from "three";

import { PALETTE, STOPS } from "./route";

/** Stage 3 — a small collection stop with a building, waste container and a
 *  pulsing waypoint marker. */
export function PickupStop() {
  const ring = useRef<Mesh>(null);

  useFrame((state) => {
    if (!ring.current) return;
    const t = (state.clock.elapsedTime % 2) / 2;
    const s = 0.3 + t * 0.6;
    ring.current.scale.set(s, s, s);
    (ring.current.material as { opacity: number }).opacity = (1 - t) * 0.8;
  });

  return (
    <group position={STOPS.pickup}>
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
        <boxGeometry args={[1, 0.68, 0.9]} />
        <meshStandardMaterial color="#e6e4d8" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <boxGeometry args={[1.08, 0.08, 0.98]} />
        <meshStandardMaterial color={PALETTE.sage} roughness={0.7} />
      </mesh>
      <mesh position={[0.3, 0.3, 0.46]}>
        <planeGeometry args={[0.3, 0.34]} />
        <meshStandardMaterial color={PALETTE.warm} emissive={PALETTE.warm} emissiveIntensity={0.5} />
      </mesh>
      {/* waste container */}
      <mesh position={[-0.62, 0.18, 0.3]} castShadow>
        <boxGeometry args={[0.32, 0.36, 0.3]} />
        <meshStandardMaterial color={PALETTE.truck} roughness={0.55} />
      </mesh>
      {/* waypoint marker */}
      <mesh position={[0, 1.1, 0]}>
        <sphereGeometry args={[0.1, 14, 14]} />
        <meshStandardMaterial color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.6, 6]} />
        <meshStandardMaterial color={PALETTE.forest} />
      </mesh>
      {/* ground pulse */}
      <mesh ref={ring} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.42, 32]} />
        <meshBasicMaterial color={PALETTE.lime} transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  );
}
