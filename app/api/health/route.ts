// Liveness/startup probe for Cloud Run and uptime checks. No dependencies, no data.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, revision: process.env.K_REVISION ?? "local" });
}
