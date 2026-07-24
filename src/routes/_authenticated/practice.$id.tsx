import { createFileRoute } from "@tanstack/react-router";

// Reuse interview room for pressure mode. Different URL to keep sessions distinct;
// same UI, no full report focus.
export { Route as _Route } from "./interview.$id";

export const Route = createFileRoute("/_authenticated/practice/$id")({
  component: PressurePractice,
});

function PressurePractice() {
  const { id } = Route.useParams();
  // Delegate to the interview room via redirect-like render
  if (typeof window !== "undefined") {
    window.history.replaceState({}, "", `/interview/${id}`);
    window.location.replace(`/interview/${id}`);
  }
  return null;
}
