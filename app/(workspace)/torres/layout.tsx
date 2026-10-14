import { LocationNavigation } from "@/components/location-navigation";

export default function TowersLayout({ children }: { children: React.ReactNode }) {
  return <div className="page-stack"><LocationNavigation />{children}</div>;
}
