import { useMemo } from "react";
import aAsset from "@/assets/interviewer-a.jpg.asset.json";
import bAsset from "@/assets/interviewer-b.jpg.asset.json";
import cAsset from "@/assets/interviewer-c.jpg.asset.json";

export type InterviewerId = "A" | "B" | "C";

interface Props {
  speaking: InterviewerId | null;
  avatarConfig?: Record<InterviewerId, { image?: string; label?: string }>;
}

const defaults: Record<InterviewerId, { image: string; label: string; accent: string }> = {
  A: { image: aAsset.url, label: "A · 전공", accent: "#f59e0b" },
  B: { image: bAsset.url, label: "B · 논리", accent: "#3b82f6" },
  C: { image: cAsset.url, label: "C · 인성", accent: "#ef4444" },
};

function Portrait({
  id,
  image,
  label,
  accent,
  speaking,
}: {
  id: InterviewerId;
  image: string;
  label: string;
  accent: string;
  speaking: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center">
      <div
        className={`relative overflow-hidden rounded-2xl border transition-all duration-500 ${
          speaking
            ? "scale-[1.04] border-transparent shadow-[0_0_40px_-4px_var(--iv-accent)]"
            : "scale-100 border-white/5 opacity-80"
        }`}
        style={{ ["--iv-accent" as string]: accent, width: "clamp(180px, 22vw, 340px)" }}
      >
        <img
          src={image}
          alt={`면접관 ${id}`}
          className={`h-full w-full object-cover ${speaking ? "iv-speak-anim" : "iv-idle-anim"}`}
          draggable={false}
        />
        {speaking && (
          <div
            className="pointer-events-none absolute inset-0 ring-2 ring-inset"
            style={{ boxShadow: `inset 0 0 0 2px ${accent}` }}
          />
        )}
      </div>
      <div
        className={`mt-3 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          speaking ? "text-foreground" : "text-muted-foreground"
        }`}
        style={{ background: speaking ? `${accent}33` : "rgba(0,0,0,.4)" }}
      >
        {label}
      </div>
    </div>
  );
}

export function InterviewerAvatars({ speaking, avatarConfig }: Props) {
  const list = useMemo(
    () =>
      (["A", "B", "C"] as const).map((id) => ({
        id,
        image: avatarConfig?.[id]?.image ?? defaults[id].image,
        label: avatarConfig?.[id]?.label ?? defaults[id].label,
        accent: defaults[id].accent,
      })),
    [avatarConfig],
  );

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-end overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 20%, #1a2033 0%, #0b0f1c 55%, #05070d 100%)",
      }}
    >
      <style>{`
        @keyframes iv-idle { 0%,100%{transform:translateY(0) scale(1);} 50%{transform:translateY(-2px) scale(1.005);} }
        @keyframes iv-speak { 0%,100%{transform:translateY(0) scale(1);} 25%{transform:translateY(-3px) scale(1.01);} 60%{transform:translateY(1px) scale(1.005);} }
        .iv-idle-anim { animation: iv-idle 6s ease-in-out infinite; }
        .iv-speak-anim { animation: iv-speak 1.6s ease-in-out infinite; }
      `}</style>

      {/* portraits row */}
      <div className="relative z-10 flex w-full items-end justify-center gap-[3vw] pb-[10vh] pt-[6vh]">
        {list.map((p) => (
          <Portrait
            key={p.id}
            id={p.id}
            image={p.image}
            label={p.label}
            accent={p.accent}
            speaking={speaking === p.id}
          />
        ))}
      </div>

      {/* wooden desk */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 h-[22vh]"
        style={{
          background:
            "linear-gradient(180deg,#8a5a34 0%,#6b4322 25%,#4a2d15 70%,#2a1808 100%)",
          boxShadow:
            "inset 0 3px 0 rgba(255,220,180,0.15), inset 0 -20px 40px rgba(0,0,0,0.6), 0 -10px 40px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="h-full w-full opacity-30 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(0,0,0,.3) 0 2px, transparent 2px 40px), repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 90px)",
          }}
        />
      </div>

      {/* floor shadow under desk */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[22vh] z-10 h-16 bg-gradient-to-b from-transparent to-black/60" />
    </div>
  );
}
