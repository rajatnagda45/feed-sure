import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { Group, MathUtils } from "three";

import { CBGPlant } from "./CBGPlant";
import { CollectionRoad } from "./CollectionRoad";
import { CollectionTruck } from "./CollectionTruck";
import { FlowParticles } from "./FlowParticles";
import { PickupStop } from "./PickupStop";
import { SupplierKitchen } from "./SupplierKitchen";
import { Trees } from "./Trees";
import { PALETTE } from "./route";

const ENTRANCE = 1.7; // seconds

/** Fits the orthographic miniature to the canvas width and holds the
 *  isometric vantage point. */
function CameraRig() {
  const { camera, size } = useThree();
  const zoom = MathUtils.clamp(size.width / 17.5, 26, 62);
  if ("zoom" in camera && camera.zoom !== zoom) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  camera.position.set(10, 9.2, 10);
  camera.lookAt(0, 0.6, -0.3);
  return null;
}

/** Holds the whole landscape; runs the one-time entrance and the restrained
 *  pointer parallax / mobile auto-sway. */
function World({
  progress,
  started,
  onStage,
  interactive,
}: {
  progress: React.MutableRefObject<number>;
  started: React.MutableRefObject<boolean>;
  onStage: (s: number) => void;
  interactive: boolean;
}) {
  const group = useRef<Group>(null);
  const start = useRef<number | null>(null);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - start.current;

    // Entrance: rise + settle, once.
    if (elapsed < ENTRANCE) {
      const t = elapsed / ENTRANCE;
      const e = 1 - Math.pow(1 - t, 3);
      g.position.y = -1.8 * (1 - e);
      const s = 0.86 + 0.14 * e;
      g.scale.setScalar(s);
    } else {
      g.position.y = 0;
      g.scale.setScalar(1);
      if (!started.current) started.current = true;
    }

    // Parallax toward pointer (desktop) or gentle auto-sway (mobile).
    let targetX = 0;
    let targetY = 0;
    if (interactive) {
      targetY = state.pointer.x * 0.16;
      targetX = -state.pointer.y * 0.08;
    } else {
      targetY = Math.sin(state.clock.elapsedTime * 0.25) * 0.08;
    }
    g.rotation.y = MathUtils.lerp(g.rotation.y, targetY, 0.05);
    g.rotation.x = MathUtils.lerp(g.rotation.x, targetX, 0.05);
  });

  return (
    <group ref={group}>
      {/* island base — ivory to blend with the page */}
      <mesh position={[0, -0.04, -0.3]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[11, 64]} />
        <meshStandardMaterial color={PALETTE.ivory} roughness={1} />
      </mesh>
      {/* a hint of water in the lower basin */}
      <mesh position={[1.4, -0.02, -4.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.4, 40]} />
        <meshStandardMaterial color={PALETTE.water} roughness={0.3} metalness={0.1} transparent opacity={0.65} />
      </mesh>

      <ContactShadows position={[0, 0.01, -0.3]} scale={18} far={6} blur={2.6} opacity={0.32} color={PALETTE.deep} />

      <SupplierKitchen />
      <PickupStop />
      <CBGPlant />
      <Trees />
      <CollectionRoad progress={progress} />
      <FlowParticles />
      <CollectionTruck progress={progress} started={started} onStage={onStage} />
    </group>
  );
}

export default function SceneCanvas({
  onStage,
  interactive,
  active,
}: {
  onStage: (s: number) => void;
  interactive: boolean;
  active: boolean;
}) {
  const progress = useRef(0);
  const started = useRef(false);

  return (
    <Canvas
      orthographic
      camera={{ position: [10, 9.2, 10], zoom: 42, near: -50, far: 100 }}
      dpr={[1, 1.6]}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      shadows
      style={{ background: "transparent" }}
    >
      <CameraRig />
      <hemisphereLight args={["#ffffff", "#cfd8cc", 0.75]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <World progress={progress} started={started} onStage={onStage} interactive={interactive} />
    </Canvas>
  );
}
