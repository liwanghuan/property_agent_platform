import { requireAgent } from "@/lib/agent";
import { formatPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function NeedsPage() {
  await requireAgent();
  const supabase = await createClient();
  // Private: only this agent's buyer needs. Team matching uses anonymised need cards (M3).
  const { data: needs, error } = await supabase
    .from("buyer_needs")
    .select("id, raw_summary, listing_kind, unit_types, districts, budget_min, budget_max, bedrooms_min, status, contacts(name)")
    .order("created_at", { ascending: false });

  return (
    <main className="page">
      <h1>Buyer needs</h1>
      <p className="muted">Private to you. Teammates only ever see an anonymised card.</p>
      {error && <p className="error">{error.message}</p>}
      {needs?.length === 0 && <p className="muted">No buyer needs yet.</p>}
      {needs?.map((n) => (
        <div className="card" key={n.id}>
          <div className="row spread">
            <span className="card-title">{(n.contacts as unknown as { name: string } | null)?.name ?? "Buyer"}</span>
            <span className="tag">{n.status}</span>
          </div>
          <div className="muted">{n.raw_summary}</div>
          <div className="muted">
            {formatPrice(n.budget_min)} – {formatPrice(n.budget_max)} · {n.unit_types?.join(", ")} · {n.districts?.join(", ")}
          </div>
        </div>
      ))}
    </main>
  );
}
