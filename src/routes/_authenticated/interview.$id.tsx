import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateNextQuestion, endSession, saveAnswer } from "@/lib/interview.functions";
import { InterviewerAvatars, type InterviewerId } from "@/components/interview/InterviewerAvatars";
import { SelfCamera } from "@/components/interview/SelfCamera";
import { ControlDrawer } from "@/components/interview/ControlDrawer";
import { useAmbientSfx, useAudioReactor } from "@/lib/interview-audio";
import { speak, cancelSpeak, type Voice } from "@/lib/tts";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/interview/$id")({
  head: () => ({
    meta: [
      { title: "면접장 · AI 구술면접" },
      { name: "description", content: "3인 AI 면접관과의 실전 압박 구술면접." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InterviewRoom,
});

interface QuestionRec {
  id: string;
  question_text: string;
  interviewer: string;
  keywords: string[];
  is_followup: boolean;
  order_idx: number;
}

function InterviewRoom() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const nextFn = useServerFn(generateNextQuestion);
  const endFn = useServerFn(endSession);
  const saveFn = useServerFn(saveAnswer);

  const [current, setCurrent] = useState<QuestionRec | null>(null);
  const [speaking, setSpeaking] = useState<InterviewerId | null>(null);
  const [answering, setAnswering] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("면접 시작 준비 중...");
  const [timeSec, setTimeSec] = useState<number | null>(90);
  const [timeEnabled, setTimeEnabled] = useState(true);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [voices, setVoices] = useState<Record<InterviewerId, Voice>>({
    A: { gender: "male", rate: 1.0, pitch: 1.0 },
    B: { gender: "female", rate: 1.05, pitch: 1.1 },
    C: { gender: "male", rate: 0.95, pitch: 0.9 },
  });

  const sfx = useAmbientSfx();
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const answerStartRef = useRef<number>(0);
  const silenceCountRef = useRef(0);
  const currentRef = useRef<QuestionRec | null>(null);
  const ttsPlayingRef = useRef(false);

  // Load session config once
  useEffect(() => {
    supabase
      .from("interview_sessions")
      .select("per_question_time_sec, time_limit_enabled")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setTimeSec(data.per_question_time_sec ?? 90);
          setTimeEnabled(data.time_limit_enabled);
        }
      });
  }, [id]);

  const askNext = useCallback(async () => {
    setStatus("면접관이 생각 중...");
    setAnswering(false);
    setTranscript("");
    silenceCountRef.current = 0;
    try {
      const q = (await nextFn({ data: { session_id: id } })) as QuestionRec;
      currentRef.current = q;
      setCurrent(q);
      setSpeaking(q.interviewer as InterviewerId);
      setStatus(`면접관 ${q.interviewer}이(가) 질문 중...`);
      ttsPlayingRef.current = true;
      await speak(q.question_text, voices[q.interviewer as InterviewerId]);
      ttsPlayingRef.current = false;
      setSpeaking(null);
      startAnswering();
    } catch (e) {
      setStatus("질문 생성 실패: " + (e instanceof Error ? e.message : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, voices]);

  const startAnswering = useCallback(async () => {
    setAnswering(true);
    setStatus("지금 답변하세요.");
    answerStartRef.current = Date.now();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const form = new FormData();
        form.append("file", blob, "answer.webm");
        try {
          const r = await fetch("/api/stt", { method: "POST", body: form });
          const j = (await r.json()) as { text?: string };
          const text = j.text ?? "";
          setTranscript(text);
          const dur = Math.round((Date.now() - answerStartRef.current) / 1000);
          if (currentRef.current) {
            await saveFn({
              data: {
                session_id: id,
                question_id: currentRef.current.id,
                transcript: text,
                duration_sec: dur,
                silence_events: silenceCountRef.current,
              },
            });
          }
        } catch (e) {
          console.warn("STT failed", e);
        }
        askNext();
      };
      rec.start();
    } catch (e) {
      setStatus("마이크 접근 실패: " + (e instanceof Error ? e.message : ""));
    }
  }, [askNext, id, saveFn]);

  // Timer
  useEffect(() => {
    if (!answering || !timeEnabled || timeSec === null) {
      setRemaining(null);
      return;
    }
    setRemaining(timeSec);
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return null;
        if (r <= 1) {
          clearInterval(t);
          // Interviewer cut-in
          const iv = currentRef.current?.interviewer as InterviewerId | undefined;
          if (iv) {
            setSpeaking(iv);
            speak("네, 거기까지 할게요. 다음 질문으로 넘어가겠습니다.", voices[iv]).then(() => setSpeaking(null));
          }
          finishAnswering();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answering, timeEnabled, timeSec]);

  function finishAnswering() {
    setAnswering(false);
    setStatus("답변 처리 중...");
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }

  useAudioReactor({
    isActive: answering,
    onSilence3s: () => {
      silenceCountRef.current++;
      if (!ttsPlayingRef.current && Math.random() < 0.7) sfx.paperFlip();
    },
    onLongRambling: () => !ttsPlayingRef.current && Math.random() < 0.6 && sfx.sigh(),
    onMumble: () => !ttsPlayingRef.current && Math.random() < 0.6 && sfx.throat(),
    onLoudEnough: () => {
      // Detect keyword mention → pen scribble
      if (ttsPlayingRef.current) return;
      const kw = currentRef.current?.keywords ?? [];
      if (kw.length && Math.random() < 0.05 && kw.some((k) => transcript.includes(k))) sfx.penScribble();
    },
  });

  // Kick off first question
  useEffect(() => {
    const t = setTimeout(askNext, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function endInterview() {
    cancelSpeak();
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    await endFn({ data: { session_id: id } });
    navigate({ to: "/report/$id", params: { id } });
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-exam-room text-foreground">
      <div className="relative flex-1">
        <InterviewerAvatars speaking={speaking} />
        <div className="absolute right-4 top-4 h-40 w-56">
          <SelfCamera className="h-full w-full" />
        </div>
        <div className="absolute inset-x-0 bottom-24 mx-auto max-w-3xl px-6">
          <div className="rounded-xl border border-border bg-black/50 p-4 backdrop-blur">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{status}</span>
              {current && (
                <span>
                  Q{current.order_idx + 1} · 면접관 {current.interviewer}
                  {current.is_followup ? " · 꼬리질문" : ""}
                </span>
              )}
            </div>
            {current && (
              <p className="mt-2 text-lg font-medium leading-relaxed">{current.question_text}</p>
            )}
            {transcript && (
              <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                <span className="text-primary">내 답변: </span>
                {transcript}
              </p>
            )}
          </div>
        </div>
      </div>
      <ControlDrawer
        timeSec={timeSec}
        timeEnabled={timeEnabled}
        onTimeChange={setTimeSec}
        onTimeEnabledChange={setTimeEnabled}
        voices={voices}
        onVoiceChange={(id, v) => setVoices((prev) => ({ ...prev, [id]: v }))}
        onEnd={endInterview}
        onSkip={finishAnswering}
        answering={answering}
        remaining={remaining}
      />
    </div>
  );
}
