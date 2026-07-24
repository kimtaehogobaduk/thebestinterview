import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  listMySessions,
  getMyProfile,
  getMyDocuments,
  analyzeSchool,
  startSession,
} from "@/lib/interview.functions";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const listFn = useServerFn(listMySessions);
  const profileFn = useServerFn(getMyProfile);
  const docsFn = useServerFn(getMyDocuments);
  const analyzeFn = useServerFn(analyzeSchool);
  const startFn = useServerFn(startSession);

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => listFn() });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => profileFn() });
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => docsFn() });

  const [school, setSchool] = useState("");
  const [schoolType, setSchoolType] = useState("자사고");
  const [mode, setMode] = useState<"full" | "pressure">("full");
  const [time, setTime] = useState<number | null>(90);
  const [starting, setStarting] = useState(false);

  const hasDocs =
    (docs.data?.find((d) => d.kind === "jaso")?.extracted_text?.length ?? 0) > 30 &&
    (docs.data?.find((d) => d.kind === "saengbu")?.extracted_text?.length ?? 0) > 30;

  async function beginSession() {
    if (!school.trim()) return;
    if (!hasDocs) {
      alert("자기소개서와 생활기록부를 먼저 등록해 주세요.");
      navigate({ to: "/documents" });
      return;
    }
    setStarting(true);
    try {
      const analysis = await analyzeFn({ data: { school, school_type: schoolType } });
      const { id } = await startFn({
        data: {
          mode,
          target_school: school,
          school_type: schoolType,
          per_question_time_sec: time,
          time_limit_enabled: time !== null,
        },
      });
      // Attach analysis to session
      await supabase.from("interview_sessions").update({ school_analysis: analysis as never }).eq("id", id);
      navigate({ to: mode === "full" ? "/interview/$id" : "/practice/$id", params: { id } });
    } catch (e) {
      alert(e instanceof Error ? e.message : "오류");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-md bg-primary" />
          <span className="font-semibold">Interview Room</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/documents" className="text-muted-foreground hover:text-foreground">
            자소서/생기부
          </Link>
          <Link to="/admin" className="text-muted-foreground hover:text-foreground">
            관리자
          </Link>
          <span className="text-muted-foreground">{profile.data?.email}</span>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-12">
        <h1 className="text-3xl font-bold tracking-tight">
          {profile.data?.display_name ?? "지원자"}님, 준비되셨나요?
        </h1>
        <p className="mt-2 text-muted-foreground">
          {hasDocs
            ? "자소서·생기부 등록 완료. 목표 학교를 지정하고 면접장에 입장하세요."
            : "먼저 자기소개서와 생활기록부를 등록해 주세요."}
        </p>

        {!hasDocs && (
          <Link
            to="/documents"
            className="mt-6 inline-block rounded-md bg-primary px-5 py-3 font-medium text-primary-foreground"
          >
            자소서·생기부 등록하기 →
          </Link>
        )}

        <section className="mt-10 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">새 면접 시작</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">지원 학교</label>
              <input
                placeholder="예: 서울과학고, 하나고, 대원외고"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">학교 유형</label>
              <select
                value={schoolType}
                onChange={(e) => setSchoolType(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {["과학고", "영재학교", "자사고", "외고", "국제고", "기타"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">모드</label>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setMode("full")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${mode === "full" ? "border-primary bg-primary/10 text-foreground" : "border-input"}`}
                >
                  풀코스 + 리포트
                </button>
                <button
                  onClick={() => setMode("pressure")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${mode === "pressure" ? "border-primary bg-primary/10 text-foreground" : "border-input"}`}
                >
                  압박 훈련
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">문항당 시간</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {[
                  { v: 60, l: "1분" },
                  { v: 90, l: "1분 30초" },
                  { v: 120, l: "2분" },
                  { v: null, l: "무제한" },
                ].map((o) => (
                  <button
                    key={o.l}
                    onClick={() => setTime(o.v)}
                    className={`rounded-md border px-3 py-2 text-xs ${time === o.v ? "border-primary bg-primary/10" : "border-input"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={beginSession}
            disabled={starting || !school.trim()}
            className="mt-6 rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {starting ? "학교 분석 중..." : "면접장 입장"}
          </button>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">내 면접 기록</h2>
          <div className="mt-4 space-y-2">
            {sessions.data?.length ? (
              sessions.data.map((s) => (
                <Link
                  key={s.id}
                  to="/report/$id"
                  params={{ id: s.id }}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 hover:border-primary"
                >
                  <div>
                    <div className="font-medium">{s.target_school}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.started_at).toLocaleString("ko-KR")} · {s.mode === "full" ? "풀코스" : "압박훈련"} · {s.status === "ended" ? "종료" : "진행중"}
                    </div>
                  </div>
                  <span className="text-sm text-primary">리포트 →</span>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">아직 세션이 없습니다.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
