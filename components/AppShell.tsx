import Link from "next/link";
import { signOut } from "@/app/actions";
import type { AgentProfile } from "@/lib/agent";

export function AppShell({ agent, children }: { agent: AgentProfile; children: React.ReactNode }) {
  const isLeader = agent.role === "leader" || agent.role === "admin";
  return (
    <>
      <header className="topbar">
        <strong>{agent.display_name}</strong>
        <form action={signOut}>
          <button className="link">Sign out</button>
        </form>
      </header>
      {children}
      <nav className="tabbar">
        <Link href="/inbox">Inbox</Link>
        <Link href="/listings">Listings</Link>
        <Link href="/needs">Needs</Link>
        <Link href="/viewings">Viewings</Link>
        {isLeader && <Link href="/dashboard">Team</Link>}
      </nav>
    </>
  );
}
