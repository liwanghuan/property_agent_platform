import { formatDate, formatPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

// Every number here comes from SECURITY DEFINER functions that return aggregates and
// listing-level fields only — the leader has no row access to chats, contacts or needs.
const STAT_LABELS: Record<string, string> = {
  agents_active: "Active agents today",
  intake_batches: "Intake batches today",
  listings_confirmed: "Listings confirmed today",
  listings_team_visible_total: "Team listings live",
  need_cards_active: "Active buyer cards",
  matches_created: "Matches today",
  matches_revealed: "Matches accepted today",
  packs_exported: "Packs exported today",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const [stats, listings, inactive] = await Promise.all([
    supabase.rpc("team_stats").single<Record<string, number | string>>(),
    supabase.rpc("team_listings_overview"),
    supabase.rpc("inactive_agents", { p_days: 7 }),
  ]);
  const error = stats.error ?? listings.error ?? inactive.error;

  return (
    <main className="page">
      <h1>Team today</h1>
      {error && <p className="error">{error.message}</p>}
      {stats.data && (
        <div className="stats">
          {Object.entries(STAT_LABELS).map(([key, label]) => (
            <div className="stat" key={key}>
              <div className="stat-value">{stats.data[key]}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <h2>Inactive 7+ days</h2>
      {inactive.data?.length === 0 && <p className="muted">Everyone has been active.</p>}
      {inactive.data?.map((a: { agent_id: string; display_name: string; last_active_at: string | null }) => (
        <div className="card row spread" key={a.agent_id}>
          <span>{a.display_name}</span>
          <span className="muted">{a.last_active_at ? `last active ${formatDate(a.last_active_at)}` : "never active"}</span>
        </div>
      ))}

      <h2>Team listings ({listings.data?.length ?? 0})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Project</th><th>District</th><th>Type</th><th>Price</th><th>Agent</th></tr>
          </thead>
          <tbody>
            {listings.data?.map((l: { listing_id: string; project_name: string | null; district: string | null; unit_type: string | null; asking_price: number | null; listing_kind: string | null; agent_name: string }) => (
              <tr key={l.listing_id}>
                <td>{l.project_name ?? "Landed"}</td>
                <td>{l.district}</td>
                <td>{l.unit_type}</td>
                <td>{formatPrice(l.asking_price, l.listing_kind)}</td>
                <td>{l.agent_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
