import type { Metadata } from "next";
import "./globals.css";
import "@/components/tower-view.css";
import "./theme.css";

const themeScript = `try{var theme=localStorage.getItem("ingeagro-theme");if(theme==="dark"||theme==="light")document.documentElement.dataset.theme=theme}catch(e){}`;

export const metadata: Metadata = {
  title: "Inventario Ingeagro",
  description: "Gestión del inventario físico de Ingeagro",
};

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
