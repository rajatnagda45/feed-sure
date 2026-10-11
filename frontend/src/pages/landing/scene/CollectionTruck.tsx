import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, Vector3 } from "three";

import { LOOP_SECONDS, PALETTE, curve, speedFactor, stageForProgress } from "./route";

const UP = new Vector3(0, 1, 0);
const pos = new Vector3();
const look = new Vector3();
const tangent = new Vector3();

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

  useFrame((_, delta) => {
    if (!group.current || !started.current) return;
    const dt = Math.min(delta, 0.05); // clamp for frame-rate independence
    const factor = speedFactor(progress.current);
    progress.current = (progress.current + (dt / LOOP_SECONDS) * factor) % 1;

    const t = progress.current;
    curve.getPointAt(t, pos);
    curve.getTangentAt(t, tangent).normalize();
    group.current.position.set(pos.x, pos.y + 0.16, pos.z);
    look.copy(pos).add(tangent);
    group.current.up.copy(UP);
    group.current.lookAt(look.x, pos.y + 0.16, look.z);

    const spin = dt * factor * 42;
    for (const w of wheels.current) w.rotation.x += spin;

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
      position={[x, -0.12, z]}
      rotation={[0, 0, Math.PI / 2]}
      castShadow
    >
      <cylinderGeometry args={[0.12, 0.12, 0.08, 14]} />
      <meshStandardMaterial color="#20261f" roughness={0.8} />
    </mesh>
  );

  return (
    <group ref={group} scale={0.62}>
      {/* body */}
      <mesh position={[-0.12, 0.12, 0]} castShadow>
        <boxGeometry args={[0.72, 0.42, 0.44]} />
        <meshStandardMaterial color={PALETTE.truck} roughness={0.5} />
      </mesh>
      {/* rear hopper detail */}
      <mesh position={[-0.12, 0.36, 0]} castShadow>
        <boxGeometry args={[0.5, 0.12, 0.4]} />
        <meshStandardMaterial color={PALETTE.truckDark} roughness={0.6} />
      </mesh>
      {/* cab */}
      <mesh position={[0.4, 0.08, 0]} castShadow>
        <boxGeometry args={[0.3, 0.32, 0.42]} />
        <meshStandardMaterial color="#eef1ea" roughness={0.4} />
      </mesh>
      {/* windscreen */}
      <mesh position={[0.56, 0.12, 0]}>
        <boxGeometry args={[0.02, 0.18, 0.34]} />
        <meshStandardMaterial color={PALETTE.deep} roughness={0.2} metalness={0.3} />
      </mesh>
      {/* branding stripe */}
      <mesh position={[-0.12, 0.12, 0.221]}>
        <planeGeometry args={[0.4, 0.14]} />
        <meshStandardMaterial color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={0.25} />
      </mesh>
      {/* headlights */}
      <mesh position={[0.57, -0.02, 0.14]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial color={PALETTE.warm} emissive={PALETTE.warm} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh position={[0.57, -0.02, -0.14]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial color={PALETTE.warm} emissive={PALETTE.warm} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      {wheel(0.28, 0.22, 0)}
      {wheel(0.28, -0.22, 1)}
      {wheel(-0.3, 0.22, 2)}
      {wheel(-0.3, -0.22, 3)}
    </group>
  );
}
