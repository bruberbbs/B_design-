import type { StudyParams } from "@/lib/estudo/study";
import type { DateId } from "@/lib/estudo/study";

export interface SavedStudy {
  id: string;
  nome: string;
  lotIds: string[];
  params: StudyParams;
  criadoEm: string;
  areaLote: number;
  totalConstruido: number;
  pavimentos: number;
}

export interface SunState {
  enabled: boolean;
  date: DateId;
  hour: number;
}
