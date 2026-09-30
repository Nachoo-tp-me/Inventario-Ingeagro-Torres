import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/components/tower-view.css";
import "./theme.css";
import "./catalog.css";
import "./stock.css";
import "./rapid.css";
import "./exports.css";

const themeScript = `try{var theme=localStorage.getItem("ingeagro-theme");if(theme==="dark"||theme==="light")document.documentElement.dataset.theme=theme}catch(e){}`;

export const metadata: Metadata = {
  title: "Inventario Ingeagro",
  description: "Gestión del inventario físico de Ingeagro",
  applicationName: "Inventario Ingeagro Torres",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/ingeagro.svg",
    apple: "/icons/ingeagro-180.png",
  },
  appleWebApp: { capable: true, title: "Ingeagro", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#173638" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
