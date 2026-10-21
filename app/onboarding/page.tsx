"use client";

import { useActionState } from "react";
import { completeOnboarding, type OnboardingState } from "./actions";

export default function OnboardingPage() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(completeOnboarding, {});

  return (
    <main className="page narrow">
      <h1>Set up your agent profile</h1>
      <p className="muted">
        These details go into the CEA disclosure on everything you export, so they must match your registration.
      </p>
      <form className="stack" action={action}>
        <label>
          Name (as registered)
          <input name="display_name" required />
        </label>
        <label>
          CEA registration no.
          <input name="cea_reg_no" placeholder="R012345A" required />
        </label>
        <label>
          Agency name
          <input name="agency_name" required />
        </label>
        <label>
          Agency licence no.
          <input name="agency_licence_no" required />
        </label>
        <label>
          WhatsApp number (optional, defaults to your login number)
          <input name="whatsapp" inputMode="tel" />
        </label>
        <button disabled={pending}>{pending ? "Saving…" : "Continue"}</button>
        {state.error && <p className="error">{state.error}</p>}
      </form>
    </main>
  );
}
