"use client";

import dynamic from "next/dynamic";

// O jogo usa WebGL e Web Audio: renderiza só no navegador.
export const JogoClient = dynamic(() => import("./JogoApp").then((m) => m.JogoApp), {
  ssr: false,
  loading: () => <div className="fixed inset-0 grid place-items-center bg-[#0a0e18] text-sm text-white/50">Carregando…</div>,
});
