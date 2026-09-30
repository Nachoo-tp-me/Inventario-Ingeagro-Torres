import type { Metadata } from "next";
import "./globals.css";
import "@/components/tower-view.css";

export const metadata: Metadata = {
  title: "Inventario Ingeagro",
  description: "Gestión del inventario físico de Ingeagro",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
