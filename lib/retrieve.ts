import { PART_BY_ID } from "./parts";
import { MIL_CODES, SYMPTOMS, type Likelihood, type Safety, type Symptom } from "./symptoms";

export type Diagnosis = {
  reply: string;
  parts: { id: string; likelihood: Likelihood; why: string }[];
  causes: string[];
  solutions: { text: string; who: "diy" | "bengkel" }[];
  safety: Safety;
  followUp?: string;
  source: "ai" | "kb";
};

// Ways people name parts, so "busi" or "v-belt" in a message points at the right symptoms
const PART_ALIASES: Record<string, string[]> = {
  v_belt: ["v-belt", "vbelt", "v belt", "van belt", "fan belt", "sabuk"],
  rollers: ["roller", "rumah roller"],
  drive_pulley: ["puli depan", "pulley depan", "variator", "slider"],
  driven_pulley: ["puli belakang", "pulley belakang", "per cvt", "per pulley"],
  clutch_shoes: ["kampas ganda", "kampas kopling", "kopling"],
  clutch_outer: ["mangkok", "rumah kopling"],
  final_gear: ["gardan", "oli gardan", "gear box"],
  cvt_cover: ["cvt", "bak cvt"],
  spark_plug: ["busi"],
  ignition_coil: ["koil", "cop busi"],
  battery: ["aki", "accu", "baterai", "battery"],
  injector: ["injektor", "injector"],
  throttle_body: ["throttle", "throttle body", "tps", "iacv", "sensor map", "sensor iat"],
  fuel_pump: ["pompa bensin", "fuel pump", "pompa"],
  fuel_tank: ["tangki"],
  air_filter: ["filter udara", "saringan udara", "air filter"],
  front_caliper: ["kampas rem depan", "kaliper", "caliper"],
  front_master: ["minyak rem", "master rem"],
  front_disc: ["cakram", "piringan"],
  rear_drum: ["tromol", "kampas rem belakang"],
  acg_starter: ["acg", "spul", "dinamo"],
  regulator: ["kiprok", "regulator"],
  fuse_box: ["sekring", "relay"],
  ecm: ["ecm", "ecu"],
  o2_sensor: ["sensor o2", "sensor oksigen"],
  engine_oil: ["oli mesin", "oli"],
  cylinder_head: ["klep", "noken", "kepala silinder"],
  piston: ["piston", "ring piston"],
  front_fork: ["shock depan", "sok depan", "garpu"],
  rear_shock: ["shock belakang", "sok belakang"],
  steering: ["komstir", "setang"],
  side_stand: ["standar samping", "jagang"],
  frame_esaf: ["rangka", "esaf", "sasis"],
  cooling_fan: ["kipas"],
  exhaust: ["knalpot"],
};

export function normalize(text: string) {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ")} `;
}

/** Finds a PGM-FI blink code: "kedip 12", "MIL 21", "berkedip 7 kali", "panjang 2 pendek 1". */
export function milCode(text: string): number | null {
  const t = normalize(text);
  const longShort = /panjang\s*(\d)\D{0,20}pendek\s*(\d)/.exec(t);
  if (longShort) return +longShort[1] * 10 + +longShort[2];
  const patterns = [
    /(?:kedip|kedipan|berkedip|blink|blinks|mil|kode|code|injeksi)\D{0,14}?(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:x|kali)\s*(?:kedip|berkedip|blink)/,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m && MIL_CODES.has(+m[1])) return +m[1];
  }
  return null;
}

export function mentionedParts(text: string): string[] {
  const t = normalize(text);
  return Object.entries(PART_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => t.includes(` ${a} `) || t.includes(` ${a}`)))
    .map(([id]) => id);
}

/** Symptoms ranked by how well they match the text, with their scores. */
export function retrieveScored(text: string, max = 6): { s: Symptom; score: number }[] {
  const t = normalize(text);
  const parts = new Set(mentionedParts(text));
  const code = milCode(text);
  const scored = SYMPTOMS.map((s) => {
    let score = 0;
    for (const k of s.keywords) if (t.includes(k)) score += 1 + k.split(" ").length;
    for (const p of s.parts) if (parts.has(p.id)) score += p.likelihood === "high" ? 2 : 1;
    if (code !== null && s.mil === code) score += 50;
    return { s, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

export function retrieve(text: string, max = 6): Symptom[] {
  return retrieveScored(text, max).map((x) => x.s);
}

/** Diagnosis without the AI, straight from the knowledge base. */
export function localDiagnosis(text: string): Diagnosis {
  // Second match only when it is nearly as strong as the first
  const scored = retrieveScored(text, 2);
  const found = scored.filter((x, i) => i === 0 || x.score >= scored[0].score * 0.6).map((x) => x.s);
  if (found.length === 0) {
    return {
      reply:
        "Belum ketemu yang cocok. Ceritakan lebih detail: munculnya kapan (mulai jalan, pas digas, pas berhenti), bunyinya kayak apa, lampu injeksi kedip atau nggak.",
      parts: [],
      causes: [],
      solutions: [],
      safety: "ok",
      source: "kb",
    };
  }
  const main = found[0];
  const merged = new Map<string, { id: string; likelihood: Likelihood; why: string }>();
  for (const s of found) for (const p of s.parts) if (!merged.has(p.id) && PART_BY_ID.has(p.id)) merged.set(p.id, p);
  const order: Record<Likelihood, number> = { high: 0, medium: 1, low: 2 };
  return {
    reply: `Kemungkinan besar ${main.title.charAt(0).toLowerCase()}${main.title.slice(1)}.${main.checks?.length ? ` Cirinya: ${main.checks[0].charAt(0).toLowerCase()}${main.checks[0].slice(1)}.` : ""}`,
    parts: [...merged.values()].sort((a, b) => order[a.likelihood] - order[b.likelihood]).slice(0, 6),
    causes: main.causes,
    solutions: main.solutions,
    safety: found.reduce<Safety>((acc, s) => (s.safety === "stop" || acc === "stop" ? "stop" : s.safety === "caution" ? "caution" : acc), "ok"),
    source: "kb",
  };
}
