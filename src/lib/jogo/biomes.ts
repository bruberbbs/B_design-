// Aparência de cada bioma: cores do terreno, líquido, vegetação, luz, minimapa e clima.

import type { BiomeId } from "./map";

type RGB = [number, number, number];

export interface Biome {
  ground: [string, string]; // chão principal (claro → escuro, por ruído)
  secondary: string; // margens, vaus e manchas
  bed: string; // fundo sob o líquido
  rock: string; // chão das cristas
  oreTint: string;
  speck: [string, string]; // detalhes pintados no chão
  flowers: string[] | null;
  cracks?: string; // rachaduras brilhantes (vulcão)
  ripples?: string; // ondulações de duna
  liquid: {
    color: string;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
    roughness: number;
    pulse: number; // amplitude de pulsação do brilho
    level: number; // altura da superfície
    texture?: "lava" | "ice";
  };
  trees: "temperate" | "desert" | "snow" | "volcanic";
  rockColor: { h: number; s: number; l: number; lv: number };
  hemi: [string, string, number];
  sun: [string, number];
  exposure: number;
  ambient: "none" | "snow" | "dust" | "embers";
  mini: { ground: RGB; secondary: RGB; liquid: RGB; rock: RGB; tree: RGB };
}

export const BIOMES: Record<BiomeId, Biome> = {
  temperate: {
    ground: ["#a3c97a", "#6f9e57"],
    secondary: "#ecd9a2",
    bed: "#d9c48e",
    rock: "#a59b8a",
    oreTint: "#b8c56a",
    speck: ["rgba(50,100,40,0.13)", "rgba(220,240,170,0.12)"],
    flowers: ["rgba(255,255,255,0.7)", "rgba(255,200,225,0.7)", "rgba(200,190,255,0.7)"],
    liquid: { color: "#3aa7e0", emissive: "#0f4f7a", emissiveIntensity: 0.25, opacity: 0.82, roughness: 0.12, pulse: 0.05, level: -0.13 },
    trees: "temperate",
    rockColor: { h: 0.08, s: 0.1, l: 0.6, lv: 0.15 },
    hemi: ["#e4f0ff", "#6b6f4a", 1.15],
    sun: ["#fff1d6", 1.9],
    exposure: 0.98,
    ambient: "none",
    mini: { ground: [112, 168, 92], secondary: [222, 204, 150], liquid: [58, 150, 210], rock: [140, 132, 120], tree: [62, 118, 64] },
  },
  desert: {
    ground: ["#f0d49a", "#d9ad6a"],
    secondary: "#f6e6c2",
    bed: "#c9a76a",
    rock: "#c98b5a",
    oreTint: "#e7c25a",
    speck: ["rgba(170,110,50,0.14)", "rgba(255,245,220,0.18)"],
    flowers: null,
    ripples: "rgba(160,105,50,0.16)",
    liquid: { color: "#2fd0c8", emissive: "#0a6f78", emissiveIntensity: 0.3, opacity: 0.85, roughness: 0.08, pulse: 0.06, level: -0.13 },
    trees: "desert",
    rockColor: { h: 0.055, s: 0.45, l: 0.5, lv: 0.12 },
    hemi: ["#fff4e0", "#a8774a", 1.2],
    sun: ["#ffe2b0", 2.15],
    exposure: 0.95,
    ambient: "dust",
    mini: { ground: [226, 190, 128], secondary: [240, 222, 182], liquid: [60, 200, 196], rock: [178, 112, 70], tree: [110, 150, 80] },
  },
  snow: {
    ground: ["#f4f8fc", "#d6e2ee"],
    secondary: "#b9c3cc",
    bed: "#9fb4c4",
    rock: "#8e97a3",
    oreTint: "#e6dca0",
    speck: ["rgba(120,150,190,0.12)", "rgba(255,255,255,0.5)"],
    flowers: null,
    liquid: { color: "#cbeefa", emissive: "#6fb8d8", emissiveIntensity: 0.18, opacity: 0.95, roughness: 0.22, pulse: 0.02, level: -0.08, texture: "ice" },
    trees: "snow",
    rockColor: { h: 0.6, s: 0.06, l: 0.55, lv: 0.15 },
    hemi: ["#eaf4ff", "#8aa0b8", 1.25],
    sun: ["#f2f7ff", 1.7],
    exposure: 0.9,
    ambient: "snow",
    mini: { ground: [232, 240, 248], secondary: [176, 186, 196], liquid: [170, 220, 240], rock: [120, 128, 140], tree: [60, 100, 84] },
  },
  volcanic: {
    ground: ["#8d827b", "#675d57"],
    secondary: "#9c8778",
    bed: "#2a1a14",
    rock: "#2c2826",
    oreTint: "#8a7a40",
    speck: ["rgba(30,24,20,0.18)", "rgba(190,180,170,0.12)"],
    flowers: null,
    cracks: "rgba(255,110,30,0.55)",
    liquid: { color: "#ff6a1f", emissive: "#ff3d00", emissiveIntensity: 1.1, opacity: 1, roughness: 0.6, pulse: 0.3, level: -0.15, texture: "lava" },
    trees: "volcanic",
    rockColor: { h: 0.03, s: 0.08, l: 0.2, lv: 0.08 },
    hemi: ["#ffd9c4", "#4a2a20", 1.05],
    sun: ["#ffc79a", 1.75],
    exposure: 1.02,
    ambient: "embers",
    mini: { ground: [84, 78, 74], secondary: [120, 106, 94], liquid: [255, 100, 30], rock: [44, 40, 38], tree: [70, 60, 52] },
  },
};
