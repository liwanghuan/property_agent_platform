"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return setError("Enter a valid mobile number, e.g. 9123 4567");
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (error) return setError(error.message);
    setSentTo(e164);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ phone: sentTo, token: code.trim(), type: "sms" });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="page narrow">
      <h1>Sign in</h1>
      {!sentTo ? (
        <form className="stack" onSubmit={sendCode}>
          <label>
            Mobile number
            <input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9123 4567" required />
          </label>
          <button disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          <p className="muted">We sent a 6-digit code to {sentTo}.</p>
          <label>
            Code
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} required />
          </label>
          <button disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
          <button type="button" className="link" onClick={() => setSentTo(null)}>Use a different number</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
