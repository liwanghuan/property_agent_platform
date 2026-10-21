"use server";

import { redirect } from "next/navigation";
import { toE164 } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string };

const FIELDS = ["display_name", "cea_reg_no", "agency_name", "agency_licence_no"] as const;

export async function completeOnboarding(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "").trim()]));
  if (FIELDS.some((f) => !values[f])) {
    return { error: "Name, CEA registration number, agency name and agency licence number are all required." };
  }
  if (!/^[A-Z]\d{6}[A-Z]$/i.test(values.cea_reg_no)) {
    return { error: "CEA registration number looks like R012345A." };
  }
  const whatsappRaw = String(form.get("whatsapp") ?? "").trim();
  const whatsapp = whatsappRaw ? toE164(whatsappRaw) : null;
  if (whatsappRaw && !whatsapp) return { error: "WhatsApp number is not valid." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", {
    p_display_name: values.display_name,
    p_cea_reg_no: values.cea_reg_no,
    p_agency_name: values.agency_name,
    p_agency_licence_no: values.agency_licence_no,
    p_whatsapp_e164: whatsapp,
  });
  if (error) {
    return {
      error: error.message.includes("no team invite")
        ? "This number hasn't been invited to a team yet. Ask your team leader to invite you."
        : error.message,
    };
  }
  redirect("/");
}
