import type { Voice } from "@/lib/tts";
import type { InterviewerId } from "./InterviewerAvatars";

interface Props {
  timeSec: number | null;
  timeEnabled: boolean;
  onTimeChange: (t: number) => void;
  onTimeEnabledChange: (b: boolean) => void;
  voices: Record<InterviewerId, Voice>;
  onVoiceChange: (id: InterviewerId, v: Voice) => void;
  onEnd: () => void;
  onSkip: () => void;
  answering: boolean;
  remaining: number | null;
}

export function ControlDrawer({
  timeSec,
  timeEnabled,
  onTimeChange,
  onTimeEnabledChange,
  voices,
  onVoiceChange,
  onEnd,
  onSkip,
  answering,
  remaining,
}: Props) {
  return (
    <aside className="flex h-full w-80 flex-col gap-4 overflow-y-auto border-l border-border bg-card/95 p-4 backdrop-blur">
      <div>
        <h3 className="text-sm font-semibold">문항당 제한 시간</h3>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={timeEnabled}
            onChange={(e) => onTimeEnabledChange(e.target.checked)}
          />
          <span className="text-xs text-muted-foreground">타이머 사용</span>
        </div>
        {timeEnabled && (
          <>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={timeSec ?? 90}
              onChange={(e) => onTimeChange(Number(e.target.value))}
              className="mt-2 w-full"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>30초</span>
              <span className="font-mono text-foreground">
                {Math.floor((timeSec ?? 90) / 60)}:{String((timeSec ?? 90) % 60).padStart(2, "0")}
              </span>
              <span>5분</span>
            </div>
          </>
        )}
        {answering && timeEnabled && remaining !== null && (
          <div className="mt-2 rounded-md bg-secondary/60 px-3 py-2 text-center">
            <span className={`font-mono text-lg ${remaining < 10 ? "text-destructive" : "text-primary"}`}>
              {Math.max(0, remaining)}s
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold">면접관 음성</h3>
        <div className="mt-3 space-y-4">
          {(["A", "B", "C"] as const).map((id) => (
            <div key={id} className="rounded-md border border-border bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold">면접관 {id}</span>
                <select
                  value={voices[id].gender}
                  onChange={(e) => onVoiceChange(id, { ...voices[id], gender: e.target.value as "male" | "female" })}
                  className="rounded bg-secondary px-2 py-1 text-xs"
                >
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                </select>
              </div>
              <label className="block text-[10px] text-muted-foreground">속도 {voices[id].rate.toFixed(2)}x</label>
              <input
                type="range"
                min={0.7}
                max={1.4}
                step={0.05}
                value={voices[id].rate}
                onChange={(e) => onVoiceChange(id, { ...voices[id], rate: Number(e.target.value) })}
                className="w-full"
              />
              <label className="mt-1 block text-[10px] text-muted-foreground">피치 {voices[id].pitch.toFixed(2)}</label>
              <input
                type="range"
                min={0.5}
                max={1.6}
                step={0.05}
                value={voices[id].pitch}
                onChange={(e) => onVoiceChange(id, { ...voices[id], pitch: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <button
          onClick={onSkip}
          className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80"
        >
          답변 종료 · 다음 질문
        </button>
        <button
          onClick={onEnd}
          className="w-full rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground"
        >
          면접 종료 → 리포트
        </button>
      </div>
    </aside>
  );
}
