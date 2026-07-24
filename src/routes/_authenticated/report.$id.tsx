import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getSessionDetails, generateReport } from "@/lib/interview.functions";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/report/$id")({
  head: () => ({
    meta: [
      { title: "면접 리포트 · AI 수석사정관" },
      { name: "description", content: "AI 수석 입학사정관의 종합 리포트." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const { id } = Route.useParams();
  const detailsFn = useServerFn(getSessionDetails);
  const reportFn = useServerFn(generateReport);
  const [generating, setGenerating] = useState(false);

  const details = useQuery({
    queryKey: ["session", id],
    queryFn: () => detailsFn({ data: { session_id: id } }),
  });

  useEffect(() => {
    if (details.data && !details.data.report && !generating) {
      setGenerating(true);
      reportFn({ data: { session_id: id } })
        .then(() => details.refetch())
        .finally(() => setGenerating(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.data?.session?.id]);

  if (!details.data) return <div className="p-12 text-muted-foreground">불러오는 중...</div>;
  const { session, questions, answers, report } = details.data;
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← 대시보드
        </Link>
        <span className="text-sm text-muted-foreground">{session?.target_school}</span>
      </header>
      <main className="mx-auto max-w-4xl px-8 py-12">
        <h1 className="text-3xl font-bold">AI 수석사정관 리포트</h1>
        {generating && <p className="mt-4 text-primary">리포트 생성 중... (약 20초 소요)</p>}

        {report ? (
          <>
            <div className="mt-8 grid grid-cols-3 gap-4">
              {[
                { l: "합격 부합도", v: report.fit_score ?? 0 },
                { l: "논리력", v: report.logic_score ?? 0 },
                { l: "태도", v: report.attitude_score ?? 0 },
              ].map((s) => (
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
                    {report.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">강점 없음</p>
                )}
              </section>
              <section className="rounded-xl border border-border bg-card p-6">
                <h3 className="font-semibold text-destructive">약점</h3>
                {report.weaknesses?.length ? (
                  <ul className="mt-2 list-inside list-disc text-sm">
                    {report.weaknesses.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">특이 사항 없음</p>
                )}
              </section>
            </div>

            {report.full_json && typeof report.full_json === "object" && (
              <section className="mt-6 rounded-xl border border-border bg-card p-6">
                <h3 className="font-semibold">개선 액션</h3>
                <ul className="mt-2 list-inside list-decimal text-sm">
                  {((report.full_json as Record<string, unknown>).action_items as string[] | undefined)?.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          !generating && <p className="mt-4 text-muted-foreground">리포트가 없습니다.</p>
        )}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">문답 기록</h2>
          <div className="mt-4 space-y-3">
            {questions.map((q, i) => {
              const a = answerMap.get(q.id);
              return (
                <div key={q.id} className="rounded-md border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground">
                    Q{i + 1} · 면접관 {q.interviewer}
                    {q.is_followup ? " · 꼬리질문" : ""}
                  </div>
                  <div className="mt-1 font-medium">{q.question_text}</div>
                  <div className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">
                    {a?.transcript ?? "(무응답)"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
