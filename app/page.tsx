import { redirect } from "next/navigation";
import { requireAgent } from "@/lib/agent";

export default async function Home() {
  const agent = await requireAgent();
  redirect(agent.role === "agent" ? "/inbox" : "/dashboard");
}
