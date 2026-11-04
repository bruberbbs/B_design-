"use client";

import dynamic from "next/dynamic";

// O mapa usa WebGL e localStorage: renderiza só no navegador.
export const EstudoClient = dynamic(() => import("./EstudoApp").then((m) => m.EstudoApp), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-[#f1f0ec] text-sm text-neutral-500">Carregando mapa…</div>
  ),
});
