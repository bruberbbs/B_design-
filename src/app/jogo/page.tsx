import type { Metadata, Viewport } from "next";
import { JogoClient } from "@/components/jogo/JogoClient";

export const metadata: Metadata = {
  title: "Maré de Aço",
  description: "Jogo de estratégia em tempo real: colete cristais, escolha entre duas facções, construa sua base e derrote o exército rival.",
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
