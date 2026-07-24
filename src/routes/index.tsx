import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI 구술면접 시뮬레이터 — 특목고·자사고 대비" },
      {
        name: "description",
        content:
          "3인의 AI 면접관과 실전 압박감으로 진행하는 특목고·자사고 맞춤형 구술면접 훈련. 로그인 없이 즉시 시작.",
      },
      { property: "og:title", content: "AI 구술면접 시뮬레이터" },
      { property: "og:description", content: "특목고·자사고 진학을 위한 실전 압박 구술면접 훈련." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(!!s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary" />
          <span className="font-semibold tracking-tight">Interview Room</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/interview" className="rounded-md border border-input px-4 py-2 font-medium hover:bg-secondary">
            바로 면접 시작
          </Link>
          {signedIn ? (
            <Link to="/dashboard" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
              대시보드
            </Link>
          ) : (
            <Link to="/auth" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
              로그인
            </Link>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-24">
        <h1 className="text-5xl font-bold leading-tight tracking-tight md:text-6xl">
          정답 없는 구술면접을,
          <br />
          <span className="text-primary">실전 그대로</span> 훈련하세요.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          3인의 AI 면접관이 지원 학교 성향과 자소서·생기부를 실시간으로 분석해 압박 질문과
          꼬리질문을 던집니다. 로그인 없이도 모든 기능을 이용할 수 있습니다.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link to="/interview" className="rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground">
            게스트로 바로 시작 →
          </Link>
          {!signedIn && (
            <Link to="/auth" className="rounded-lg border border-input px-6 py-3 font-semibold hover:bg-secondary">
              계정 만들기 (기록 저장)
            </Link>
          )}
        </div>

        <div className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            { t: "3인 면접관 병렬 AI", d: "Cerebras gpt-oss-120b 3개 인스턴스가 전공·논리·인성을 동시에 검증합니다." },
            { t: "학교 맞춤 실시간 분석", d: "지원 학교 기출·인재상을 즉시 파악해 프롬프트에 주입." },
            { t: "실시간 자막 + STT", d: "발화 중 자막을 왼쪽 패널에서 실시간 확인." },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-border bg-card p-6">
              <h3 className="text-lg font-semibold">{c.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
