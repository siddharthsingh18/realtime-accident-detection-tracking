import React, { useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useLocation } from "react-router-dom";
import { useSessionStore } from "../../store/useSessionStore";

// Low-poly intersection scene with moving light vehicles and rotating radar
const RoadGrid: React.FC<{ hasAlert: boolean }> = ({ hasAlert }) => {
  const sceneGroupRef = useRef<THREE.Group>(null);
  const radarRef = useRef<THREE.Group>(null);
  const vehiclesRef = useRef<THREE.InstancedMesh>(null);
  const beaconRef = useRef<THREE.PointLight>(null);
  const lastUpdateRef = useRef<number>(0);

  // 12 light-trail vehicles moving along lanes
  const numVehicles = 12;
  const dummy = new THREE.Object3D();
  const vehicleStates = useRef(
    Array.from({ length: numVehicles }, (_, i) => ({
      axis: i % 2 === 0 ? ("x" as const) : ("z" as const),
      lane: (i % 4) - 1.5,
      speed: 0.04 + (i % 3) * 0.015,
      pos: (i * 2.5) % 16 - 8,
      color: i === 0 && hasAlert ? new THREE.Color("#ef4444") : new THREE.Color(i % 2 === 0 ? "#00f0ff" : "#38bdf8"),
    }))
  );

  // Explicit disposal of geometries and materials on unmount
  useEffect(() => {
    return () => {
      if (sceneGroupRef.current) {
        sceneGroupRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            if (m.material) {
              if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
              else m.material.dispose();
            }
          }
        });
      }
    };
  }, []);

  useFrame((state, delta) => {
    // Cap rendering/physics updates to ~30 FPS to reduce GPU and main-thread overhead
    const elapsed = state.clock.getElapsedTime();
    if (elapsed - lastUpdateRef.current < 0.032) return;
    lastUpdateRef.current = elapsed;

    // 1. Radar sweep rotation (capped speed)
    if (radarRef.current) {
      radarRef.current.rotation.y += delta * 1.5;
    }

    // 2. Alert beacon pulse
    if (beaconRef.current) {
      beaconRef.current.intensity = hasAlert
        ? 3.0 + Math.sin(state.clock.getElapsedTime() * 8) * 1.5
        : 1.0 + Math.sin(state.clock.getElapsedTime() * 2) * 0.3;
    }

    // 3. Move vehicles along lanes
    if (vehiclesRef.current) {
      vehicleStates.current.forEach((v, i) => {
        v.pos += v.speed;
        if (v.pos > 8) v.pos = -8;

        if (v.axis === "x") {
          dummy.position.set(v.pos, 0.15, v.lane * 1.2);
          dummy.rotation.set(0, 0, 0);
        } else {
          dummy.position.set(v.lane * 1.2, 0.15, v.pos);
          dummy.rotation.set(0, Math.PI / 2, 0);
        }
        dummy.scale.set(0.6, 0.18, 0.3);
        dummy.updateMatrix();
        vehiclesRef.current!.setMatrixAt(i, dummy.matrix);
      });
      vehiclesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={sceneGroupRef} position={[0, -0.4, 0]}>
      {/* Dark Road Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial color="#090d16" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Crossroad Lane Strips */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[18, 4]} />
        <meshStandardMaterial color="#0d1527" roughness={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[4, 18]} />
        <meshStandardMaterial color="#0d1527" roughness={0.8} />
      </mesh>

      {/* Glowing Intersection Center */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshBasicMaterial color={hasAlert ? "#ef4444" : "#00f0ff"} transparent opacity={0.2} />
      </mesh>

      {/* Rotating Radar Sweep Cone */}
      <group ref={radarRef} position={[0, 0.1, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.5, 7, 32, 1, 0, Math.PI / 4]} />
          <meshBasicMaterial
            color={hasAlert ? "#ef4444" : "#00f0ff"}
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Moving Vehicles (Instanced for high FPS) */}
      <instancedMesh ref={vehiclesRef} args={[undefined, undefined, numVehicles]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={hasAlert ? "#ef4444" : "#00f0ff"} />
      </instancedMesh>

      {/* Central Alert Beacon */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 1.2, 16]} />
        <meshStandardMaterial color="#334155" metalness={0.9} />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshBasicMaterial color={hasAlert ? "#ef4444" : "#10b981"} />
      </mesh>
      <pointLight
        ref={beaconRef}
        position={[0, 1.4, 0]}
        color={hasAlert ? "#ef4444" : "#10b981"}
        distance={12}
        intensity={2.0}
      />
    </group>
  );
};

export const HeroTrafficScene: React.FC<{ className?: string }> = ({ className = "" }) => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  // Scoped boolean selector: do not subscribe to high-frequency telemetry object
  const hasAlert = useSessionStore((state) => (state.telemetry?.confirmed_accidents ?? 0) > 0);
  const [isVisible, setIsVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const isLiveWall = location.pathname === "/wall" || location.pathname.startsWith("/camera");

  // IntersectionObserver to pause rendering when off-screen
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Pause rendering when tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) setIsVisible(false);
      else setIsVisible(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Do not run the 3D scene on Low or Off effects levels
  if (effectsQuality === "off" || effectsQuality === "low") {
    return (
      <div
        ref={containerRef}
        className={`relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center ${className}`}
      >
        <div className="text-center p-4">
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-cyan-400 mx-auto flex items-center justify-center mb-2">
            <span className={`w-3 h-3 rounded-full ${hasAlert ? "bg-rose-500" : "bg-emerald-400"}`} />
          </div>
          <div className="font-display font-bold text-xs uppercase tracking-wider text-slate-300">
            Telemetry Command Link Active (2D Mode)
          </div>
        </div>
      </div>
    );
  }

  const shouldRender3D = isVisible && !isLiveWall;

  return (
    <div
      ref={containerRef}
      className={`relative rounded-2xl overflow-hidden border border-cyan-500/20 bg-slate-950/80 shadow-[0_0_30px_rgba(0,0,0,0.6)] ${className}`}
    >
      {shouldRender3D && (
        <Canvas
          camera={{ position: [0, 9, 11], fov: 42 }}
          frameloop={shouldRender3D ? "always" : "never"}
          dpr={Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5)}
          gl={{ powerPreference: "low-power", antialias: true }}
        >
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 15, 10]} intensity={0.8} />
          <RoadGrid hasAlert={hasAlert} />
        </Canvas>
      )}

      {/* Cyberpunk HUD Frame Overlay */}
      <div className="absolute top-2 left-3 flex items-center gap-2 pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-300 font-bold">
          3D Mission Spatial Feed
        </span>
      </div>

      <div className="absolute bottom-2 right-3 font-mono text-[9px] text-slate-500 pointer-events-none">
        {hasAlert ? "ALERT ENGAGED // SECTOR 1" : "SECTOR MONITORING // 30 FPS"}
      </div>
    </div>
  );
};
export default HeroTrafficScene;
