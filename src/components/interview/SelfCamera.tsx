import { useEffect, useRef } from "react";

interface Props {
  className?: string;
}

/**
 * Picture-in-picture live self-camera.
 */
export function SelfCamera({ className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (e) {
        console.warn("camera denied", e);
      }
    })();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className={`overflow-hidden rounded-lg border-2 border-primary/40 bg-black shadow-lg ${className ?? ""}`}>
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-white/10" />
    </div>
  );
}
