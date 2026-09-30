import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUTHORIZED_USER_ID } from "@/lib/authorized-user";

export async function requireAuthorizedUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/login");
  if (data.claims.sub !== AUTHORIZED_USER_ID)
    redirect("/login?acceso=denegado");
  return supabase;
}
