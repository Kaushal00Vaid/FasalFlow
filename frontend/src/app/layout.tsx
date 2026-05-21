import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "FasalFlow Field Intelligence",
  description: "AI-guided visit planning for Syngenta",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${outfit.variable} font-sans antialiased bg-neutral-950 text-neutral-50 selection:bg-emerald-500/30 selection:text-emerald-200`}
      >
        <div className="flex flex-col md:flex-row min-h-screen bg-neutral-950">
          <Navigation />
          <main className="flex-1 w-full bg-neutral-950 relative md:ml-64 pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
