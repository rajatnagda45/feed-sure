import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CylinderGeometry, Group, Mesh, Quaternion, Vector3 } from "three";

import { LOOP_SECONDS, PALETTE, curve, speedFactor, stageForProgress } from "./route";

/** The model is built facing +X; the tangent aligns that axis to travel. */
const FORWARD = new Vector3(1, 0, 0);
const pos = new Vector3();
const tangent = new Vector3();
const quat = new Quaternion();

/** Approximate loop length in world units, so wheel spin matches real speed. */
const LOOP_LENGTH = curve.getLength();
const WHEEL_RADIUS = 0.13;

export function CollectionTruck({
  progress,
  onStage,
  started,
}: {
  progress: React.MutableRefObject<number>;
  onStage: (stage: number) => void;
  started: React.MutableRefObject<boolean>;
}) {
  const group = useRef<Group>(null);
  const wheels = useRef<Mesh[]>([]);
  const lastStage = useRef(-1);

  // Wheel axle runs left–right (local Z) so spinning around Z rolls it forward.
  const wheelGeo = useMemo(() => {
    const g = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.09, 16);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  useEffect(() => () => wheelGeo.dispose(), [wheelGeo]);

  useFrame((_, delta) => {
    if (!group.current || !started.current) return;
    const dt = Math.min(delta, 0.05); // frame-rate independent
    const factor = speedFactor(progress.current);
    const step = (dt / LOOP_SECONDS) * factor;
    progress.current = (progress.current + step) % 1;

    const t = progress.current;
    curve.getPointAt(t, pos);
    curve.getTangentAt(t, tangent);
    tangent.y = 0;
    tangent.normalize();

    // Settle onto the road with a faint load bob at low speed.
    const bob = (1 - factor) * 0.015 * Math.sin(performance.now() * 0.012);
    group.current.position.set(pos.x, pos.y + 0.12 + bob, pos.z);
    quat.setFromUnitVectors(FORWARD, tangent);
    group.current.quaternion.copy(quat);

    // Wheel spin derived from distance actually travelled this frame.
    const spin = (step * LOOP_LENGTH) / WHEEL_RADIUS;
    for (const w of wheels.current) w.rotation.z -= spin;

    const stage = stageForProgress(t);
    if (stage !== lastStage.current) {
      lastStage.current = stage;
      onStage(stage);
    }
  });

  const wheel = (x: number, z: number, i: number) => (
    <mesh
      key={i}
      ref={(m) => {
        if (m) wheels.current[i] = m;
      }}
      geometry={wheelGeo}
      position={[x, -0.13, z]}
      castShadow
    >
      <meshStandardMaterial color="#20261f" roughness={0.8} />
    </mesh>
  );

  return (
    <group ref={group} scale={0.95}>
      {/* chassis */}
      <mesh position={[-0.1, 0.02, 0]} castShadow>
        <boxGeometry args={[0.95, 0.12, 0.5]} />
        <meshStandardMaterial color={PALETTE.truckDark} roughness={0.6} />
      </mesh>
      {/* cargo body */}
      <mesh position={[-0.2, 0.3, 0]} castShadow>
        <boxGeometry args={[0.66, 0.46, 0.5]} />
        <meshStandardMaterial color={PALETTE.truck} roughness={0.5} />
      </mesh>
      {/* rear hopper lid */}
      <mesh position={[-0.2, 0.56, 0]} castShadow>
        <boxGeometry args={[0.46, 0.1, 0.46]} />
        <meshStandardMaterial color={PALETTE.truckDark} roughness={0.6} />
      </mesh>
      {/* cab */}
      <mesh position={[0.42, 0.24, 0]} castShadow>
        <boxGeometry args={[0.34, 0.38, 0.48]} />
        <meshStandardMaterial color="#eef1ea" roughness={0.4} />
      </mesh>
      {/* windscreen */}
      <mesh position={[0.6, 0.3, 0]}>
        <boxGeometry args={[0.03, 0.2, 0.4]} />
        <meshStandardMaterial color={PALETTE.deep} roughness={0.15} metalness={0.3} />
      </mesh>
      {/* branding stripe */}
      <mesh position={[-0.2, 0.3, 0.251]}>
        <planeGeometry args={[0.42, 0.16]} />
        <meshStandardMaterial color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[-0.2, 0.3, -0.251]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.42, 0.16]} />
        <meshStandardMaterial color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={0.3} />
      </mesh>
      {/* headlights */}
      <mesh position={[0.6, 0.12, 0.16]}>
        <sphereGeometry args={[0.045, 10, 10]} />
        <meshStandardMaterial color={PALETTE.warm} emissive={PALETTE.warm} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <mesh position={[0.6, 0.12, -0.16]}>
        <sphereGeometry args={[0.045, 10, 10]} />
        <meshStandardMaterial color={PALETTE.warm} emissive={PALETTE.warm} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      {wheel(0.34, 0.25, 0)}
      {wheel(0.34, -0.25, 1)}
      {wheel(-0.32, 0.25, 2)}
      {wheel(-0.32, -0.25, 3)}
    </group>
  );
}
