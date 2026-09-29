import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inventario Ingeagro Torres",
  description: "Aplicación web de Ingeagro Torres",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
