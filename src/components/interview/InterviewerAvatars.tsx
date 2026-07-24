import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

export type InterviewerId = "A" | "B" | "C";

interface Props {
  speaking: InterviewerId | null;
  avatarConfig?: Record<InterviewerId, { skin?: string; suit?: string; accent?: string }>;
}

const defaults: Record<InterviewerId, { skin: string; suit: string; accent: string; label: string }> = {
  A: { skin: "#f0c7a3", suit: "#1e293b", accent: "#f59e0b", label: "A · 전공" },
  B: { skin: "#e5b48a", suit: "#0f172a", accent: "#3b82f6", label: "B · 논리" },
  C: { skin: "#f4d1b0", suit: "#1c1917", accent: "#ef4444", label: "C · 인성" },
};

function Interviewer({ id, position, config, speaking }: {
  id: InterviewerId;
  position: [number, number, number];
  config: { skin: string; suit: string; accent: string };
  speaking: boolean;
}) {
  const headRef = useRef<THREE.Group | null>(null);
  const jawRef = useRef<THREE.Mesh | null>(null);
  const eyeLRef = useRef<THREE.Mesh | null>(null);
  const eyeRRef = useRef<THREE.Mesh | null>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (headRef.current) {
      const idle = Math.sin(t * 0.6 + position[0]) * 0.04;
      headRef.current.rotation.y = idle + (speaking ? Math.sin(t * 3) * 0.06 : 0);
      headRef.current.rotation.x = speaking ? Math.sin(t * 2.4) * 0.03 : idle * 0.5;
    }
    if (jawRef.current) {
      const scaleY = speaking ? 1 + Math.abs(Math.sin(t * 12)) * 0.35 : 1;
      jawRef.current.scale.y = scaleY;
    }
    if (eyeLRef.current && eyeRRef.current) {
      const glance = Math.sin(t * 0.4 + position[0] * 2) * 0.05;
      eyeLRef.current.position.x = -0.11 + glance;
      eyeRRef.current.position.x = 0.11 + glance;
    }
  });

  return (
    <group position={position}>
      {/* torso / suit */}
      <mesh position={[0, -1, 0]}>
        <cylinderGeometry args={[0.55, 0.7, 1.5, 24]} />
        <meshStandardMaterial color={config.suit} />
      </mesh>
      {/* neck */}
      <mesh position={[0, -0.15, 0]}>
        <cylinderGeometry args={[0.18, 0.2, 0.25, 16]} />
        <meshStandardMaterial color={config.skin} />
      </mesh>
      {/* head */}
      <group ref={headRef} position={[0, 0.2, 0]}>
        <mesh>
          <sphereGeometry args={[0.42, 32, 32]} />
          <meshStandardMaterial color={config.skin} roughness={0.6} />
        </mesh>
        {/* hair */}
        <mesh position={[0, 0.15, -0.02]} scale={[1, 0.55, 1]}>
          <sphereGeometry args={[0.44, 32, 32]} />
          <meshStandardMaterial color="#111827" roughness={0.9} />
        </mesh>
        {/* eyes */}
        <mesh ref={eyeLRef} position={[-0.11, 0.03, 0.36]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshStandardMaterial color="#0b1220" />
        </mesh>
        <mesh ref={eyeRRef} position={[0.11, 0.03, 0.36]}>
          <sphereGeometry args={[0.045, 16, 16]} />
          <meshStandardMaterial color="#0b1220" />
        </mesh>
        {/* jaw / mouth */}
        <mesh ref={jawRef} position={[0, -0.16, 0.36]}>
          <boxGeometry args={[0.14, 0.03, 0.02]} />
          <meshStandardMaterial color="#3b0d1a" />
        </mesh>
      </group>
      {/* accent tie */}
      <mesh position={[0, -0.5, 0.51]}>
        <boxGeometry args={[0.08, 0.5, 0.02]} />
        <meshStandardMaterial color={config.accent} />
      </mesh>
      {/* speaking ring */}
      {speaking && (
        <mesh position={[0, -1.7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 1.05, 32]} />
          <meshBasicMaterial color={config.accent} transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}

function Desk() {
  return (
    <mesh position={[0, -2.05, 0.6]}>
      <boxGeometry args={[6, 0.15, 1.6]} />
      <meshStandardMaterial color="#1a2033" />
    </mesh>
  );
}

export function InterviewerAvatars({ speaking, avatarConfig }: Props) {
  const configs = useMemo(() => {
    return (["A", "B", "C"] as const).map((id) => ({
      id,
      ...defaults[id],
      ...(avatarConfig?.[id] ?? {}),
    }));
  }, [avatarConfig]);

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [0, 0.2, 5], fov: 42 }} shadows>
        <color attach="background" args={["#0d1220"]} />
        <fog attach="fog" args={["#0d1220", 6, 15]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} castShadow />
        <directionalLight position={[-4, 2, 2]} intensity={0.4} color="#4b6cb7" />
        <Suspense fallback={null}>
          <Interviewer
            id="A"
            position={[-2, 0, 0]}
            config={{ skin: configs[0].skin, suit: configs[0].suit, accent: configs[0].accent }}
            speaking={speaking === "A"}
          />
          <Interviewer
            id="B"
            position={[0, 0.05, 0.1]}
            config={{ skin: configs[1].skin, suit: configs[1].suit, accent: configs[1].accent }}
            speaking={speaking === "B"}
          />
          <Interviewer
            id="C"
            position={[2, 0, 0]}
            config={{ skin: configs[2].skin, suit: configs[2].suit, accent: configs[2].accent }}
            speaking={speaking === "C"}
          />
          <Desk />
        </Suspense>
        <OrbitControls enablePan={false} enableZoom={false} maxPolarAngle={Math.PI / 2.1} minPolarAngle={Math.PI / 2.6} />
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-around px-16 text-xs text-muted-foreground">
        {configs.map((c) => (
          <div
            key={c.id}
            className={`rounded-full px-3 py-1 ${speaking === c.id ? "bg-primary/20 text-foreground" : "bg-black/40"}`}
          >
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}
