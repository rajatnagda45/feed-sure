import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Mesh,
  Vector3,
} from "three";

import { PALETTE, curve } from "./route";

/** Build a flat road ribbon lying on the ground by offsetting sampled curve
 *  points perpendicular to the travel direction. */
function ribbonGeometry(src: CatmullRomCurve3, width: number, segments: number, y: number) {
  const half = width / 2;
  const up = new Vector3(0, 1, 0);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = src.getPointAt(t);
    const tangent = src.getTangentAt(t);
    const side = new Vector3().crossVectors(tangent, up).normalize().multiplyScalar(half);
    positions.push(p.x - side.x, y, p.z - side.z);
    positions.push(p.x + side.x, y, p.z + side.z);
    uvs.push(0, t * segments, 1, t * segments);
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function CollectionRoad({ progress }: { progress: React.MutableRefObject<number> }) {
  const roadGeo = useMemo(() => ribbonGeometry(curve, 0.92, 240, 0.02), []);
  const lineGeo = useMemo(() => ribbonGeometry(curve, 0.08, 240, 0.055), []);
  const sparkRef = useRef<Mesh>(null);

  // Travelling collection light runs just ahead of the truck along the route.
  useFrame(() => {
    if (!sparkRef.current) return;
    const ahead = (progress.current + 0.06) % 1;
    const p = curve.getPointAt(ahead);
    sparkRef.current.position.set(p.x, 0.12, p.z);
  });

  return (
    <group>
      <mesh geometry={roadGeo} receiveShadow>
        <meshStandardMaterial color={PALETTE.road} roughness={0.95} metalness={0} />
      </mesh>
      <mesh geometry={lineGeo}>
        <meshStandardMaterial
          color={PALETTE.lime}
          emissive={PALETTE.lime}
          emissiveIntensity={0.35}
          roughness={0.6}
          transparent
          opacity={0.55}
        />
      </mesh>
      <mesh ref={sparkRef}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={PALETTE.lime}
          emissive={PALETTE.lime}
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
