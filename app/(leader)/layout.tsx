import { AppShell } from "@/components/AppShell";
import { requireLeader } from "@/lib/agent";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const agent = await requireLeader();
  return <AppShell agent={agent}>{children}</AppShell>;
}
