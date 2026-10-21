import { requireAgent } from "@/lib/agent";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function ViewingsPage() {
  await requireAgent();
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("viewing_sessions")
    .select("id, title, viewing_date, status, viewing_items(count), client_feedback(count)")
    .order("viewing_date", { ascending: false });

  return (
    <main className="page">
      <h1>Viewings</h1>
      <p className="muted">Recap builder arrives in M2.</p>
      {error && <p className="error">{error.message}</p>}
      {sessions?.length === 0 && <p className="muted">No viewing sessions yet.</p>}
      {sessions?.map((s) => (
        <div className="card" key={s.id}>
          <div className="row spread">
            <span className="card-title">{s.title}</span>
            <span className="tag">{s.status}</span>
          </div>
          <div className="muted">
            {formatDate(s.viewing_date)} · {(s.viewing_items as unknown as { count: number }[])[0]?.count ?? 0} units ·{" "}
            {(s.client_feedback as unknown as { count: number }[])[0]?.count ?? 0} client responses
          </div>
        </div>
      ))}
    </main>
  );
}
