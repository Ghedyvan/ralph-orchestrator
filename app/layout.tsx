import type {Metadata} from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Ralph Kanban",
  description: "Kanban para visualizar o progresso do prd.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
