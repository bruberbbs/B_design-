import type { Metadata, Viewport } from "next";
import { JogoClient } from "@/components/jogo/JogoClient";

export const metadata: Metadata = {
  title: "Maré de Aço",
  description: "Jogo de estratégia em tempo real: colete cristais, construa sua base e derrote a Legião Escarlate.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0e18",
};

export default function JogoPage() {
  return <JogoClient />;
}
