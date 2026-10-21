import { AppShell } from "@/components/AppShell";
import { requireAgent } from "@/lib/agent";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const agent = await requireAgent();
  return <AppShell agent={agent}>{children}</AppShell>;
}
