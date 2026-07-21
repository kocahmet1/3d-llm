import type { Metadata } from "next";
import { headers } from "next/headers";
import { DirectorPanel } from "./components/director/DirectorPanel";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: {
      default: "Inside One Training Step",
      template: "%s · Inside One Training Step",
    },
    description: "An interactive 3D journey through one LLM training step with a contextual Realtime voice guide.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      title: "Inside One Training Step",
      description: "Point at a live 3D training exhibit and ask a contextual voice guide how it works.",
      images: [
        {
          url: "/og-assistant.png",
          width: 1672,
          height: 941,
          alt: "A translucent cyan guide points to one warm highlighted cell in a floating attention matrix inside a dark 3D training chamber.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Inside One Training Step",
      description: "Point, ask, and explore one complete language-model training step in 3D.",
      images: ["/og-assistant.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <DirectorPanel />
      </body>
    </html>
  );
}
