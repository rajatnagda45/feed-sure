import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { InstancedMesh, Matrix4, Vector3 } from "three";

import { PALETTE, curve } from "./route";

const COUNT = 36;
const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpS = new Vector3();
const EMPTY_Q = { x: 0, y: 0, z: 0, w: 1 } as const;

/** Waste-to-resource particles: they ride the collection route from the
 *  supplier arc toward the plant, rising and fading as they travel. */
export function FlowParticles() {
  const mesh = useRef<InstancedMesh>(null);
  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        offset: i / COUNT,
        speed: 0.02 + (i % 5) * 0.004,
        size: 0.5 + ((i * 37) % 10) / 14,
        wobble: (i * 1.3) % 6.28,
      })),
    [],
  );

  useFrame((state) => {
    if (!mesh.current) return;
    const time = state.clock.elapsedTime;
    seeds.forEach((s, i) => {
      // Travel only across the front arc (kitchen → plant ≈ 0 .. 0.55).
      const p = (s.offset + time * s.speed) % 1;
      const along = 0.02 + (p % 1) * 0.5;
      curve.getPointAt(along, tmpP);
      const rise = Math.sin(p * Math.PI) * 0.5 + 0.18;
      const sway = Math.sin(time * 1.6 + s.wobble) * 0.08;
      tmpP.set(tmpP.x + sway, tmpP.y + rise, tmpP.z + sway);
      const scale = (0.05 + Math.sin(p * Math.PI) * 0.05) * s.size;
      tmpS.setScalar(scale);
      tmpM.compose(tmpP, EMPTY_Q as never, tmpS);
      mesh.current!.setMatrixAt(i, tmpM);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial
        color={PALETTE.lime}
        emissive={PALETTE.lime}
        emissiveIntensity={1.1}
        transparent
        opacity={0.85}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
