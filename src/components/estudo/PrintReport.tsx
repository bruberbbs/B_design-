"use client";

import { fmt, terrainInfo, type Lot } from "@/lib/estudo/city";
import type { StudyParams, StudyResult } from "@/lib/estudo/study";
import { m2 } from "./LotPanel";

interface Props {
  lots: Lot[];
  result: StudyResult;
  params: StudyParams;
  snapshot: string | null;
  nome: string;
}

export function PrintReport({ lots, result, params, snapshot, nome }: Props) {
  const lot = lots[0];
  const t = terrainInfo(lot);
  const z = result.zone;
  const rows: [string, string][] = [
    ["Inscrição", lots.map((l) => l.inscricao).join(", ")],
    ["Frente para", `${lot.frontStreet.name} (${lot.frontStreet.kind})`],
    ["Área do lote", m2(result.areaLote)],
    ["Cotas do terreno", `${fmt(t.cotaMin, 1)} a ${fmt(t.cotaMax, 1)} m (desnível ${fmt(t.desnivel, 1)} m)`],
    ["Zona", `${z.id} · ${z.nome}`],
    ["IA básico / máximo", `${fmt(z.iaBasico, 2)} / ${fmt(z.iaMaximo, 2)}`],
    ["Taxa de ocupação", `${Math.round(z.taxaOcupacao * 100)}%`],
    ["Gabarito", `${z.maxPavimentos} pavimentos`],
    ["Recuos (frente · fundos · lateral)", `${fmt(z.recuoFrontal, 1)} · ${fmt(z.recuoFundos, 1)} · ${fmt(z.recuoLateral, 1)} m`],
  ];
  const resultRows: [string, string][] = [
    ["Pavimentos · altura", `${result.pavimentos} · ${fmt(result.altura, 1)} m`],
    ["Projeção (térreo)", m2(result.projecao)],
    ["Total construído", m2(result.totalConstruido)],
    [`Limite pelo IA ${params.usarIaMaximo ? "máximo" : "básico"}`, m2(result.limiteIa)],
    ["IA utilizado", fmt(result.iaUtilizado, 2)],
    ["Taxa de ocupação utilizada", `${fmt(result.taxaOcupacao * 100, 1)}%`],
    ["Uso", params.uso],
    ["Unidades · salas", `${result.unidades} · ${result.salas}`],
    ["Área privativa", m2(result.areaPrivativa)],
    ["Vagas necessárias", String(result.vagas)],
  ];
  return (
    <article className="hidden p-0 font-sans text-[11px] text-black print:block">
      <header className="mb-3 flex items-end justify-between border-b border-black pb-2">
        <div>
          <div className="text-[10px] tracking-wider text-neutral-600 uppercase">Estudo de viabilidade</div>
          <h1 className="text-lg font-semibold">{nome}</h1>
        </div>
        <div className="text-right text-[10px] text-neutral-600">{new Date().toLocaleDateString("pt-BR")}</div>
      </header>
      {snapshot && (
        // eslint-disable-next-line @next/next/no-img-element -- captura do canvas em data URL
        <img src={snapshot} alt="Vista do estudo de massa" className="mb-3 max-h-[300px] w-full rounded object-cover" />
      )}
      <div className="grid grid-cols-2 gap-6">
        <section>
          <h2 className="mb-1 text-xs font-semibold">Terreno e zoneamento</h2>
          <Table rows={rows} />
        </section>
        <section>
          <h2 className="mb-1 text-xs font-semibold">Resultado do estudo</h2>
          <Table rows={resultRows} />
        </section>
      </div>
      {result.avisos.length > 0 && (
        <section className="mt-3">
          <h2 className="mb-1 text-xs font-semibold">Observações</h2>
          <ul className="list-disc pl-4">
            {result.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-4 text-[9px] text-neutral-500">
        Estudo preliminar gerado automaticamente com parâmetros ilustrativos. Não substitui consulta de viabilidade junto à prefeitura.
      </p>
    </article>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-neutral-200">
            <td className="py-1 pr-2 text-neutral-600">{k}</td>
            <td className="py-1 text-right">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
