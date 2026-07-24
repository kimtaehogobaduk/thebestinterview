import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof Blob)) {
            return new Response(JSON.stringify({ error: "file required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (file.size < 1500) {
            return Response.json({ text: "" });
          }
          const { groqTranscribe } = await import("@/lib/ai.server");
          const name = (file as File).name || "audio.webm";
          const text = await groqTranscribe(file, name);
          return Response.json({ text });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "STT error";
          console.error("[STT]", msg);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
