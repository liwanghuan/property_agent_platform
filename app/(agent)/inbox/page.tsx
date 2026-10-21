import { requireAgent } from "@/lib/agent";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function InboxPage() {
  await requireAgent();
  const supabase = await createClient();
  // RLS returns only this agent's batches.
  const { data: batches, error } = await supabase
    .from("intake_batches")
    .select("id, channel, status, created_at, raw_messages(count)")
    .order("created_at", { ascending: false });

  return (
    <main className="page">
      <h1>Inbox</h1>
      <p className="muted">Forwarded chats and uploads become draft listings here. Intake arrives in M1.</p>
      {error && <p className="error">{error.message}</p>}
      {batches?.length === 0 && <p className="muted">Nothing yet.</p>}
      {batches?.map((b) => (
        <div className="card" key={b.id}>
          <div className="row spread">
            <span className="card-title">{b.channel} batch</span>
            <span className="tag">{b.status}</span>
          </div>
          <div className="muted">
            {(b.raw_messages as unknown as { count: number }[])[0]?.count ?? 0} messages · {formatDate(b.created_at)}
          </div>
        </div>
      ))}
    </main>
  );
}
