import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  publicAnalyzeSchool,
  publicNextQuestion,
  publicReport,
} from "@/lib/interview-public.functions";
import { InterviewerAvatars, type InterviewerId } from "@/components/interview/InterviewerAvatars";
import { SelfCamera } from "@/components/interview/SelfCamera";
import { ControlDrawer } from "@/components/interview/ControlDrawer";
import { useAmbientSfx, useAudioReactor } from "@/lib/interview-audio";
import { speak, cancelSpeak, type Voice } from "@/lib/tts";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/interview")({
  head: () => ({
    meta: [
      { title: "면접장 · AI 구술면접" },
      { name: "description", content: "로그인 없이 즉시 시작하는 3인 AI 면접관 구술면접." },
    ],
  }),
  component: InterviewPage,
});

type Phase = "setup" | "running" | "report";
interface QA {
  order: number;
  interviewer: InterviewerId;
  question: string;
  answer: string;
  duration_sec: number;
  keywords: string[];
  is_followup: boolean;
}

const LS = {
  school: "iv.school",
  type: "iv.school_type",
  mode: "iv.mode",
  jaso: "iv.jaso",
  saengbu: "iv.saengbu",
};

function InterviewPage() {
  const analyzeFn = useServerFn(publicAnalyzeSchool);
  const nextFn = useServerFn(publicNextQuestion);
  const reportFn = useServerFn(publicReport);

  const [phase, setPhase] = useState<Phase>("setup");
  const [school, setSchool] = useState("");
  const [schoolType, setSchoolType] = useState("자사고");
  const [mode, setMode] = useState<"full" | "pressure">("full");
  const [jaso, setJaso] = useState("");
  const [saengbu, setSaengbu] = useState("");
  const [analysis, setAnalysis] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);

  const [qa, setQa] = useState<QA[]>([]);
  const [current, setCurrent] = useState<QA | null>(null);
  const [speaking, setSpeaking] = useState<InterviewerId | null>(null);
  const [answering, setAnswering] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [liveText, setLiveText] = useState("");
  const [status, setStatus] = useState("");
  const [timeSec, setTimeSec] = useState<number | null>(90);
  const [timeEnabled, setTimeEnabled] = useState(true);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [voices, setVoices] = useState<Record<InterviewerId, Voice>>({
    A: { gender: "male", rate: 1.0, pitch: 1.0 },
    B: { gender: "female", rate: 1.05, pitch: 1.1 },
    C: { gender: "male", rate: 0.95, pitch: 0.9 },
  });
  const [report, setReport] = useState<{
    summary: string;
    fit_score: number;
    logic_score: number;
    attitude_score: number;
    strengths: string[];
    weaknesses: string[];
    action_items?: string[];
  } | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const sfx = useAmbientSfx();
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const answerStartRef = useRef<number>(0);
  const silenceCountRef = useRef(0);
  const currentRef = useRef<QA | null>(null);
  const ttsPlayingRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // Prefill from localStorage + profile
  useEffect(() => {
    const url = new URL(window.location.href);
    const qs = url.searchParams.get("school");
    const qt = url.searchParams.get("type");
    const qm = url.searchParams.get("mode");
    const ls = {
      school: qs || localStorage.getItem(LS.school) || "",
      type: qt || localStorage.getItem(LS.type) || "자사고",
      mode: (qm || localStorage.getItem(LS.mode) || "full") as "full" | "pressure",
      jaso: localStorage.getItem(LS.jaso) || "",
      saengbu: localStorage.getItem(LS.saengbu) || "",
    };
    setSchool(ls.school);
    setSchoolType(ls.type);
    setMode(ls.mode);
    setJaso(ls.jaso);
    setSaengbu(ls.saengbu);
    // If logged in, try loading target_school from profile
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("target_school, school_type")
        .eq("id", data.user.id)
        .maybeSingle();
      if (prof?.target_school && !ls.school) {
        setSchool(prof.target_school);
      }
      if (prof?.school_type && !qt) {
        setSchoolType(prof.school_type);
      }
    });
  }, []);

  const beginSession = async () => {
    if (!school.trim()) return;
    setStarting(true);
    try {
      localStorage.setItem(LS.school, school);
      localStorage.setItem(LS.type, schoolType);
      localStorage.setItem(LS.mode, mode);
      localStorage.setItem(LS.jaso, jaso);
      localStorage.setItem(LS.saengbu, saengbu);
      const a = await analyzeFn({ data: { school, school_type: schoolType } });
      setAnalysis(a);
      // persist school to profile if logged in
      supabase.auth.getUser().then(async ({ data }) => {
        if (data.user) {
          await supabase
            .from("profiles")
            .update({ target_school: school, school_type: schoolType })
            .eq("id", data.user.id);
        }
      });
      setPhase("running");
      setTimeout(() => askNext(a, []), 400);
    } catch (e) {
      alert(e instanceof Error ? e.message : "학교 분석 실패");
    } finally {
      setStarting(false);
    }
  };

  const askNext = useCallback(
    async (schoolAnalysis: unknown, prevList: QA[]) => {
      setStatus("면접관이 생각 중...");
      setAnswering(false);
      setTranscript("");
      setLiveText("");
      silenceCountRef.current = 0;
      try {
        const q = await nextFn({
          data: {
            target_school: school,
            school_type: schoolType,
            school_analysis: schoolAnalysis,
            jaso,
            saengbu,
            prev: prevList.map((p) => ({
              order: p.order,
              interviewer: p.interviewer,
              question: p.question,
              answer: p.answer,
              duration_sec: p.duration_sec,
            })),
          },
        });
        const newQ: QA = {
          order: q.order_idx,
          interviewer: q.interviewer as InterviewerId,
          question: q.question_text,
          answer: "",
          duration_sec: 0,
          keywords: q.keywords,
          is_followup: q.is_followup,
        };
        currentRef.current = newQ;
        setCurrent(newQ);
        setSpeaking(newQ.interviewer);
        setStatus(`면접관 ${newQ.interviewer}이(가) 질문 중...`);
        ttsPlayingRef.current = true;
        await speak(newQ.question, voices[newQ.interviewer]);
        ttsPlayingRef.current = false;
        setSpeaking(null);
        startAnswering();
      } catch (e) {
        setStatus("질문 생성 실패: " + (e instanceof Error ? e.message : ""));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [school, schoolType, jaso, saengbu, voices],
  );

  const startAnswering = useCallback(async () => {
    setAnswering(true);
    setStatus("지금 답변하세요.");
    answerStartRef.current = Date.now();
    // Live captions via Web Speech API
    setLiveText("");
    const SR =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (SR) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec: any = new (SR as any)();
        rec.lang = "ko-KR";
        rec.continuous = true;
        rec.interimResults = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rec.onresult = (ev: any) => {
          let text = "";
          for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript + " ";
          setLiveText(text.trim());
        };
        rec.onerror = () => {};
        rec.start();
        recognitionRef.current = { stop: () => { try { rec.stop(); } catch { /* ignore */ } } };
      } catch { /* ignore */ }
    }
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
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        const blob = new Blob(chunksRef.current, { type: mime });
        const form = new FormData();
        form.append("file", blob, "answer.webm");
        let text = liveText;
        try {
          const r = await fetch("/api/stt", { method: "POST", body: form });
          const j = (await r.json()) as { text?: string };
          if (j.text && j.text.trim()) text = j.text;
        } catch (e) {
          console.warn("STT failed", e);
        }
        setTranscript(text);
        const dur = Math.round((Date.now() - answerStartRef.current) / 1000);
        if (currentRef.current) {
          const finalQ: QA = { ...currentRef.current, answer: text, duration_sec: dur };
          setQa((prev) => {
            const next = [...prev, finalQ];
            // schedule next question
            setTimeout(() => askNext(analysis, next), 600);
            return next;
          });
        }
      };
      rec.start();
    } catch (e) {
      setStatus("마이크 접근 실패: " + (e instanceof Error ? e.message : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askNext, analysis]);

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
          const iv = currentRef.current?.interviewer;
          if (iv) {
            setSpeaking(iv);
            speak("네, 거기까지 할게요. 다음 질문으로 넘어가겠습니다.", voices[iv]).then(() =>
              setSpeaking(null),
            );
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
      if (ttsPlayingRef.current) return;
      const kw = currentRef.current?.keywords ?? [];
      if (kw.length && Math.random() < 0.05 && kw.some((k) => liveText.includes(k))) sfx.penScribble();
    },
  });

  async function endInterview() {
    cancelSpeak();
    if (recRef.current && recRef.current.state !== "inactive") {
      try { recRef.current.stop(); } catch { /* ignore */ }
    }
    setAnswering(false);
    setPhase("report");
    setGeneratingReport(true);
    try {
      const r = await reportFn({
        data: {
          target_school: school,
          mode,
          qa: qa.map((p) => ({
            order: p.order,
            interviewer: p.interviewer,
            question: p.question,
            answer: p.answer,
            duration_sec: p.duration_sec,
          })),
        },
      });
      setReport(r);
    } catch (e) {
      alert("리포트 생성 실패: " + (e instanceof Error ? e.message : ""));
    } finally {
      setGeneratingReport(false);
    }
  }

  if (phase === "setup") return <SetupView {...{ school, setSchool, schoolType, setSchoolType, mode, setMode, jaso, setJaso, saengbu, setSaengbu, starting, beginSession }} />;
  if (phase === "report") return <ReportView report={report} generating={generatingReport} qa={qa} school={school} onRestart={() => window.location.reload()} />;

  return <RoomView {...{ current, speaking, transcript, liveText, status, timeSec, timeEnabled, setTimeSec, setTimeEnabled, voices, setVoices, remaining, answering, finishAnswering, endInterview }} />;
}

function SetupView(props: {
  school: string; setSchool: (v: string) => void;
  schoolType: string; setSchoolType: (v: string) => void;
  mode: "full" | "pressure"; setMode: (v: "full" | "pressure") => void;
  jaso: string; setJaso: (v: string) => void;
  saengbu: string; setSaengbu: (v: string) => void;
  starting: boolean; beginSession: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <button onClick={() => navigate({ to: "/" })} className="text-sm text-muted-foreground hover:text-foreground">← 홈</button>
        <span className="text-sm text-muted-foreground">비로그인으로도 모든 기능을 이용할 수 있습니다</span>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">새 면접 시작</h1>
        <p className="mt-2 text-muted-foreground">문항당 시간은 면접 중 실시간으로 조절할 수 있습니다.</p>

        <section className="mt-8 rounded-xl border border-border bg-card p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">지원 학교</label>
              <input
                placeholder="예: 서울과학고, 하나고, 대원외고"
                value={props.school}
                onChange={(e) => props.setSchool(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">이 기기와 (로그인 시) 계정에 저장됩니다.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">학교 유형</label>
              <select
                value={props.schoolType}
                onChange={(e) => props.setSchoolType(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {["과학고", "영재학교", "자사고", "외고", "국제고", "기타"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-muted-foreground">모드</label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => props.setMode("full")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${props.mode === "full" ? "border-primary bg-primary/10" : "border-input"}`}
                >풀코스 + 리포트</button>
                <button
                  onClick={() => props.setMode("pressure")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${props.mode === "pressure" ? "border-primary bg-primary/10" : "border-input"}`}
                >압박 훈련</button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold">자소서 / 생기부 (선택 · 붙여넣기)</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">등록하면 맞춤 문항 품질이 크게 향상됩니다. 이 기기에만 저장됩니다.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <textarea
              placeholder="자기소개서 텍스트"
              value={props.jaso}
              onChange={(e) => props.setJaso(e.target.value)}
              className="h-40 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs"
            />
            <textarea
              placeholder="생활기록부 요약"
              value={props.saengbu}
              onChange={(e) => props.setSaengbu(e.target.value)}
              className="h-40 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs"
            />
          </div>
        </section>

        <button
          onClick={props.beginSession}
          disabled={props.starting || !props.school.trim()}
          className="mt-8 rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {props.starting ? "학교 분석 중..." : "면접장 입장 →"}
        </button>
      </main>
    </div>
  );
}

function RoomView(props: {
  current: QA | null;
  speaking: InterviewerId | null;
  transcript: string;
  liveText: string;
  status: string;
  timeSec: number | null;
  timeEnabled: boolean;
  setTimeSec: (n: number) => void;
  setTimeEnabledCompat?: (b: boolean) => void;
  setTimeEnabled: (b: boolean) => void;
  voices: Record<InterviewerId, Voice>;
  setVoices: React.Dispatch<React.SetStateAction<Record<InterviewerId, Voice>>>;
  remaining: number | null;
  answering: boolean;
  finishAnswering: () => void;
  endInterview: () => void;
}) {
  const { current, speaking, transcript, liveText, status, timeSec, timeEnabled, setTimeSec, setTimeEnabled, voices, setVoices, remaining, answering, finishAnswering, endInterview } = props;
  const shownAnswer = liveText || transcript;
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-exam-room text-foreground">
      {/* LEFT PANEL — transcript top, camera bottom */}
      <aside className="flex h-full w-72 shrink-0 flex-col border-r border-white/10 bg-neutral-950/70 backdrop-blur">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">내 답변 (실시간)</div>
          <div className="mt-2 min-h-[8rem] rounded-md bg-black/30 p-3 text-sm leading-relaxed text-white">
            {shownAnswer || <span className="text-neutral-500">여기에 실시간으로 발화 내용이 표시됩니다.</span>}
          </div>
          {answering && timeEnabled && remaining !== null && (
            <div className="mt-3 rounded-md bg-black/40 p-3 text-center">
              <div className={`font-mono text-2xl ${remaining < 10 ? "text-destructive" : "text-primary"}`}>{Math.max(0, remaining)}s</div>
              <div className="mt-1 text-[10px] text-neutral-400">남은 시간</div>
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">내 카메라</div>
          <div className="relative mt-2 aspect-video w-full">
            <SelfCamera className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </aside>

      {/* CENTER — interviewers + current question bar */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <InterviewerAvatars speaking={speaking} />
        </div>
        <div className="relative z-30 shrink-0 border-t border-white/10 bg-neutral-950/95 px-6 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span>{status}</span>
              {current && (
                <span>Q{current.order + 1} · 면접관 {current.interviewer}{current.is_followup ? " · 꼬리질문" : ""}</span>
              )}
            </div>
            {current && (
              <p className="mt-2 text-xl font-semibold leading-relaxed text-white">{current.question}</p>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT — control drawer (time slider is live) */}
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

function ReportView({
  report,
  generating,
  qa,
  school,
  onRestart,
}: {
  report: {
    summary: string;
    fit_score: number;
    logic_score: number;
    attitude_score: number;
    strengths: string[];
    weaknesses: string[];
    action_items?: string[];
  } | null;
  generating: boolean;
  qa: QA[];
  school: string;
  onRestart: () => void;
}) {
  const scores = useMemo(
    () => [
      { l: "합격 부합도", v: report?.fit_score ?? 0 },
      { l: "논리력", v: report?.logic_score ?? 0 },
      { l: "태도", v: report?.attitude_score ?? 0 },
    ],
    [report],
  );
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <span className="text-sm text-muted-foreground">{school} · 면접 종료</span>
        <button onClick={onRestart} className="text-sm text-primary hover:underline">새 면접 시작 →</button>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold">AI 수석사정관 리포트</h1>
        {generating && <p className="mt-4 text-primary">리포트 생성 중... (약 20초)</p>}
        {report && (
          <>
            <div className="mt-8 grid grid-cols-3 gap-4">
              {scores.map((s) => (
                <div key={s.l} className="rounded-xl border border-border bg-card p-6 text-center">
                  <div className="text-xs text-muted-foreground">{s.l}</div>
                  <div className="mt-2 text-4xl font-bold text-primary">{s.v}</div>
                </div>
              ))}
            </div>
            <section className="mt-8 rounded-xl border border-border bg-card p-6">
              <h2 className="font-semibold">종합 평가</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{report.summary}</p>
            </section>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-border bg-card p-6">
                <h3 className="font-semibold text-primary">강점</h3>
                {report.strengths?.length ? (
                  <ul className="mt-2 list-inside list-disc text-sm">
                    {report.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">강점 없음</p>
                )}
              </section>
              <section className="rounded-xl border border-border bg-card p-6">
                <h3 className="font-semibold text-destructive">약점</h3>
                {report.weaknesses?.length ? (
                  <ul className="mt-2 list-inside list-disc text-sm">
                    {report.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">특이 사항 없음</p>
                )}
              </section>
            </div>
            {report.action_items && report.action_items.length > 0 && (
              <section className="mt-6 rounded-xl border border-border bg-card p-6">
                <h3 className="font-semibold">개선 액션</h3>
                <ul className="mt-2 list-inside list-decimal text-sm">
                  {report.action_items.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">문답 기록</h2>
          <div className="mt-4 space-y-3">
            {qa.map((q, i) => (
              <div key={i} className="rounded-md border border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">Q{i + 1} · 면접관 {q.interviewer}{q.is_followup ? " · 꼬리질문" : ""}</div>
                <div className="mt-1 font-medium">{q.question}</div>
                <div className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">{q.answer || "(무응답)"}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
