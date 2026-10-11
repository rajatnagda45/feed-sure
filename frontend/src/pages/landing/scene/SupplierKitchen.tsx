import { PALETTE, STOPS } from "./route";

/** Stage 1 — a small commercial kitchen with warm windows and a green
 *  organic-waste container. Anchored to the shared kitchen stop position. */
export function SupplierKitchen() {
  return (
    <group position={STOPS.kitchen}>
      {/* main block */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1, 1.4]} />
        <meshStandardMaterial color="#eceadf" roughness={0.75} />
      </mesh>
      {/* lower service wing */}
      <mesh position={[0.6, 0.3, 0.9]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.6, 0.7]} />
        <meshStandardMaterial color="#e2e0d3" roughness={0.8} />
      </mesh>
      {/* flat roof trim */}
      <mesh position={[0, 1.02, 0]} castShadow>
        <boxGeometry args={[1.9, 0.08, 1.5]} />
        <meshStandardMaterial color={PALETTE.sage} roughness={0.7} />
      </mesh>
      {/* warm windows */}
      {[-0.5, 0.1, 0.7].map((x) => (
        <mesh key={x} position={[x, 0.5, 0.71]}>
          <planeGeometry args={[0.32, 0.4]} />
          <meshStandardMaterial color={PALETTE.warm} emissive={PALETTE.warm} emissiveIntensity={0.6} />
        </mesh>
      ))}
      {/* green organic-waste container */}
      <group position={[-1.15, 0.26, 0.4]}>
        <mesh castShadow>
          <boxGeometry args={[0.5, 0.52, 0.42]} />
          <meshStandardMaterial color={PALETTE.truck} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.54, 0.08, 0.46]} />
          <meshStandardMaterial color={PALETTE.truckDark} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
