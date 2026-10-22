import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Halden Group · Executive Reporting (POC)",
  description: "Proof of concept: governed, automated multi-site reporting on a medallion architecture.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
