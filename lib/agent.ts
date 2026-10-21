import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export interface AgentProfile {
  id: string;
  team_id: string | null;
  display_name: string;
  cea_reg_no: string;
  agency_name: string;
  agency_licence_no: string;
  whatsapp_e164: string | null;
  role: "agent" | "leader" | "admin";
  keep_originals: boolean;
}

/** The signed-in agent's profile, or a redirect to /login or /onboarding. */
export async function requireAgent(): Promise<AgentProfile> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) redirect("/login");

  const { data } = await supabase.from("agents").select("*").eq("id", uid).maybeSingle();
  if (!data) redirect("/onboarding");
  return data as AgentProfile;
}

export async function requireLeader(): Promise<AgentProfile> {
  const agent = await requireAgent();
  if (agent.role !== "leader" && agent.role !== "admin") redirect("/inbox");
  return agent;
}
