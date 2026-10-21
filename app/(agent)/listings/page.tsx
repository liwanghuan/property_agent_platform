import { requireAgent } from "@/lib/agent";
import { formatPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type ListingRow = {
  id: string;
  agent_id: string;
  visibility: "private" | "team";
  status: string;
  listing_kind: string | null;
  unit_type: string | null;
  property_type: string | null;
  project_name: string | null;
  address: string | null;
  district: string | null;
  floor_band: string | null;
  bedrooms: number | null;
  built_up_sqft: number | null;
  asking_price: number | null;
  agents: { display_name: string } | null;
};

export default async function ListingsPage() {
  const agent = await requireAgent();
  const supabase = await createClient();
  // RLS returns own listings plus teammates' confirmed, team-visible ones.
  const { data, error } = await supabase
    .from("listings")
    .select("id, agent_id, visibility, status, listing_kind, unit_type, property_type, project_name, address, district, floor_band, bedrooms, built_up_sqft, asking_price, agents(display_name)")
    .order("created_at", { ascending: false })
    .returns<ListingRow[]>();

  const mine = data?.filter((l) => l.agent_id === agent.id) ?? [];
  const team = data?.filter((l) => l.agent_id !== agent.id) ?? [];

  return (
    <main className="page">
      <h1>Listings</h1>
      {error && <p className="error">{error.message}</p>}
      <h2>Mine ({mine.length})</h2>
      {mine.map((l) => <ListingCard key={l.id} listing={l} />)}
      <h2>Team ({team.length})</h2>
      {team.map((l) => <ListingCard key={l.id} listing={l} showAgent />)}
    </main>
  );
}

function ListingCard({ listing: l, showAgent }: { listing: ListingRow; showAgent?: boolean }) {
  return (
    <div className="card">
      <div className="row spread">
        <span className="card-title">{l.project_name ?? l.address ?? "Untitled listing"}</span>
        <span className="row">
          <span className={`tag ${l.visibility}`}>{l.visibility}</span>
          {l.status !== "confirmed" && <span className="tag">{l.status}</span>}
        </span>
      </div>
      <div className="muted">
        {[l.district, l.unit_type ?? l.property_type, l.floor_band && `${l.floor_band} floor`, l.bedrooms != null && `${l.bedrooms} bed`, l.built_up_sqft && `${l.built_up_sqft.toLocaleString()} sqft`]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="row spread">
        <strong>{formatPrice(l.asking_price, l.listing_kind)}</strong>
        {showAgent && <span className="muted">{l.agents?.display_name}</span>}
      </div>
    </div>
  );
}
