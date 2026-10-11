import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";

import { PALETTE } from "./route";

type Tree = { x: number; z: number; s: number; phase: number };

const TREES: Tree[] = [
  [-7.6, 2.0], [-5.1, 4.4], [-2.4, 4.0], [-8.2, 0.9], [-3.6, 1.0],
  [1.0, 2.6], [3.4, 1.2], [2.0, -1.0], [4.8, 0.4], [5.6, -1.6],
  [7.6, -2.2], [4.0, -3.4], [2.4, -5.0], [-1.6, -4.8], [-5.2, -4.0],
  [-8.0, -2.2], [-0.4, 3.4], [6.8, -4.4], [-6.6, 4.6], [0.6, -2.8],
  [-3.0, -1.6], [8.0, -0.6],
].map(([x, z]) => ({
  x,
  z,
  s: 0.7 + ((Math.abs(x * 13.1 + z * 7.7) % 10) / 10) * 0.7,
  phase: (Math.abs(x * 3.3 - z * 2.1) % 6.28),
}));

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const axis = new Vector3(0, 0, 1);

export function Trees() {
  const foliage = useRef<InstancedMesh>(null);
  const trunks = useRef<InstancedMesh>(null);
  const foliageColors = useMemo(() => {
    const base = new Color(PALETTE.forest);
    const alt = new Color(PALETTE.sage);
    return TREES.map((_, i) => base.clone().lerp(alt, (i % 5) / 8));
  }, []);

  useLayoutEffect(() => {
    TREES.forEach((t, i) => {
      tmpP.set(t.x, 0.55 * t.s, t.z);
      tmpS.set(t.s, t.s, t.s);
      tmpM.compose(tmpP, new Quaternion(), tmpS);
      foliage.current?.setMatrixAt(i, tmpM);
      foliage.current?.setColorAt(i, foliageColors[i]);
      tmpP.set(t.x, 0.14 * t.s, t.z);
      tmpM.compose(tmpP, new Quaternion(), new Vector3(t.s, t.s, t.s));
      trunks.current?.setMatrixAt(i, tmpM);
    });
    if (foliage.current) {
      foliage.current.instanceMatrix.needsUpdate = true;
      if (foliage.current.instanceColor) foliage.current.instanceColor.needsUpdate = true;
    }
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
  }, [foliageColors]);

  // Very low-amplitude canopy sway.
  useFrame((state) => {
    if (!foliage.current) return;
    const t = state.clock.elapsedTime;
    TREES.forEach((tree, i) => {
      tmpP.set(tree.x, 0.55 * tree.s, tree.z);
      tmpQ.setFromAxisAngle(axis, Math.sin(t * 0.8 + tree.phase) * 0.05);
      tmpS.set(tree.s, tree.s, tree.s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      foliage.current!.setMatrixAt(i, tmpM);
    });
    foliage.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, TREES.length]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.28, 6]} />
        <meshStandardMaterial color="#6b5a43" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={foliage} args={[undefined, undefined, TREES.length]} castShadow>
        <coneGeometry args={[0.42, 0.95, 9]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  );
}
