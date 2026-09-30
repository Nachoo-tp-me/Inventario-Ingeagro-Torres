import { AppShell } from "@/components/app-shell";
import { requireAuthorizedUser } from "@/lib/auth";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthorizedUser();
  return <AppShell>{children}</AppShell>;
}
