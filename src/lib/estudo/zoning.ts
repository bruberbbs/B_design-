// Parâmetros urbanísticos por zona (fictícios — ajuste ao plano diretor do seu município).

export type ZoneId = "ZC" | "ZMD" | "ZBD" | "ZIA" | "ZPA";

export interface ZoneParams {
  id: ZoneId;
  nome: string;
  /** índice de aproveitamento básico */
  iaBasico: number;
  /** índice de aproveitamento máximo (com outorga) */
  iaMaximo: number;
  /** taxa de ocupação (0..1) */
  taxaOcupacao: number;
  /** taxa de permeabilidade mínima (0..1) */
  permeabilidade: number;
  maxPavimentos: number;
  alturaPavimento: number;
  recuoFrontal: number;
  recuoFundos: number;
  /** recuo lateral exigido a partir do 3º pavimento */
  recuoLateral: number;
  usos: string;
  cor: string;
}

export const ZONES: Record<ZoneId, ZoneParams> = {
  ZC: {
    id: "ZC",
    nome: "Zona Central",
    iaBasico: 2.0,
    iaMaximo: 3.0,
    taxaOcupacao: 0.6,
    permeabilidade: 0.15,
    maxPavimentos: 6,
    alturaPavimento: 3.0,
    recuoFrontal: 4,
    recuoFundos: 2,
    recuoLateral: 1.5,
    usos: "Residencial multifamiliar, comércio, serviços e uso misto",
    cor: "#c98b5a",
  },
  ZMD: {
    id: "ZMD",
    nome: "Zona de Média Densidade",
    iaBasico: 1.5,
    iaMaximo: 2.0,
    taxaOcupacao: 0.55,
    permeabilidade: 0.2,
    maxPavimentos: 4,
    alturaPavimento: 3.0,
    recuoFrontal: 4,
    recuoFundos: 2,
    recuoLateral: 1.5,
    usos: "Residencial uni e multifamiliar, comércio vicinal",
    cor: "#d7b56d",
  },
  ZBD: {
    id: "ZBD",
    nome: "Zona de Baixa Densidade",
    iaBasico: 1.0,
    iaMaximo: 1.2,
    taxaOcupacao: 0.5,
    permeabilidade: 0.25,
    maxPavimentos: 3,
    alturaPavimento: 3.0,
    recuoFrontal: 4,
    recuoFundos: 1.5,
    recuoLateral: 1.5,
    usos: "Residencial unifamiliar e geminado",
    cor: "#9db67a",
  },
  ZIA: {
    id: "ZIA",
    nome: "Zona de Interesse Ambiental",
    iaBasico: 0.7,
    iaMaximo: 0.75,
    taxaOcupacao: 0.4,
    permeabilidade: 0.4,
    maxPavimentos: 2,
    alturaPavimento: 3.0,
    recuoFrontal: 5,
    recuoFundos: 3,
    recuoLateral: 1.5,
    usos: "Residencial unifamiliar de baixo impacto",
    cor: "#6fa3a0",
  },
  ZPA: {
    id: "ZPA",
    nome: "Zona de Preservação Ambiental",
    iaBasico: 0,
    iaMaximo: 0,
    taxaOcupacao: 0,
    permeabilidade: 1,
    maxPavimentos: 0,
    alturaPavimento: 3.0,
    recuoFrontal: 0,
    recuoFundos: 0,
    recuoLateral: 0,
    usos: "Não edificável",
    cor: "#5f8a5a",
  },
};
