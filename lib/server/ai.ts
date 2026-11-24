// Diagnosis with an open-weight model through an OpenAI-compatible API (Groq's free tier by default).
// The model only picks part ids from our catalog and is grounded on the matching knowledge-base entries.

import { PARTS, PART_BY_ID } from "../parts";
import { localDiagnosis, milCode, retrieve, type Diagnosis } from "../retrieve";
import type { Likelihood, Safety } from "../symptoms";

export type ChatTurn = { role: "user" | "assistant"; content: string };

const BASE = process.env.AI_BASE_URL || "https://api.groq.com/openai/v1";
const MODEL = process.env.AI_MODEL || "qwen/qwen3.8-27b";

const BIKE = `Motor: Honda BeAT eSP rangka eSAF (produksi 2020 sampai sekarang, tipe CBS, CBS ISS/Deluxe, Street).
Mesin 109,5 cc SOHC 2 klep, pendingin udara paksa (kipas), injeksi PGM-FI, kompresi 10:1, 6,6 kW/7.500 rpm, 9,2 N·m/6.000 rpm.
Transmisi V-Matic (CVT) di sisi kiri, kopling sentrifugal kering, gardan reduksi 10,625, oli gardan 0,07 L.
Starter: ACG starter (tanpa gigi starter); tipe CBS juga punya kick starter. Idling Stop System di tipe ISS.
Rem: depan cakram hidrolik piston tunggal (DOT 3/4), belakang tromol, Combi Brake System (handel kiri mengerem belakang + sebagian depan).
Ban tubeless 80/90-14 (29 psi) dan 90/90-14 (33 psi). Busi NGK MR9C-9N celah 0,8-0,9 mm. Oli 10W-30 JASO MB 0,65 L. Langsam 1.700 ± 100 rpm.
Aki di bawah dek: 12 V 3 Ah (CBS) atau 5 Ah (ISS). Sekring utama 20 A. Tangki 4,2 L di bawah jok, pompa bensin di dalam tangki. Saringan udara viscous (jangan dicuci), ganti 16.000 km. V-belt 24.000 km.
Starter hanya bekerja bila handel rem ditarik dan standar samping naik; mesin mati bila standar samping diturunkan.
Kode kedip MIL: 1 MAP, 7 EOT, 8 TP, 9 IAT, 12 injektor, 21 O2, 29 IACV, 33 ECM, 52 CKP, 54 BAS (kedip panjang = 10, pendek = 1).`;

const PART_LIST = PARTS.map((p) => `${p.id}: ${p.name}`).join("\n");

function systemPrompt(context: string) {
  return `Kamu mekanik berpengalaman yang khusus menangani Honda BeAT. Jawab keluhan pemilik motor dengan Bahasa Indonesia baku yang lugas, seperti mekanik menjelaskan hasil pemeriksaan kepada pelanggan: sopan, langsung, tanpa bahasa gaul. Istilah bengkel yang umum (kampas ganda, roller, brebet) boleh dipakai. Sebisa mungkin hindari kata ganti; bila perlu, sapa dengan "Anda". Bila pengguna menulis dalam bahasa Inggris, jawab dalam bahasa Inggris dengan gaya yang sama.

${BIKE}

Daftar komponen (pakai HANYA id ini):
${PART_LIST}

Catatan basis pengetahuan yang paling relevan dengan pesan pengguna:
${context || "(tidak ada yang cocok; andalkan pengetahuan umum tentang BeAT dan minta detail)"}

Aturan:
- Pilih 1-6 komponen yang paling mungkin, urutkan dari yang paling mungkin. likelihood: "high", "medium", atau "low". "why" satu kalimat pendek.
- causes: 2-5 kemungkinan penyebab. solutions: 2-5 langkah, tandai who "diy" bila aman dikerjakan pemilik, "bengkel" bila perlu alat atau keahlian (injeksi, CVT, rem hidrolik, klep).
- safety: "stop" bila menyangkut rem, rangka retak, kebocoran bensin, atau kemudi tidak aman; "caution" bila boleh jalan pelan ke bengkel; selain itu "ok".
- Jangan mengarang angka spesifikasi di luar data di atas. Jangan menyarankan modifikasi atau membongkar sistem injeksi sendiri.
- Bila keluhan terlalu umum, tetap beri dugaan terbaik lalu isi followUp dengan SATU pertanyaan pendek yang paling membantu.
- Bila pengguna hanya bertanya tentang komponen (bukan keluhan), jelaskan singkat dan sorot komponen itu saja.
- reply maksimal 3 kalimat, tanpa daftar. Kalimat pertama langsung dugaan utamanya.

Gaya bahasa (penting):
- Jangan buka dengan basa-basi atau mengulang keluhan ("Berdasarkan keluhan Anda", "Tentu", "Baik", "Saya mengerti", "Dari gejala yang disebutkan").
- Jangan tutup dengan "Semoga membantu", tawaran bantuan, atau saran umum seperti "periksakan ke bengkel terpercaya".
- Hindari kata yang berlebihan atau klise: "optimal", "secara menyeluruh", "sangat penting", "hal ini", "disarankan untuk".
- Tulis konkret: sebut bagian, gejala, dan tindakan yang spesifik. Lebih baik pendek daripada lengkap tapi kosong.
- Isi why, causes dan solutions dengan frasa pendek seperti catatan servis, bukan kalimat penjelasan panjang.

Balas HANYA dengan JSON:
{"reply": string, "parts": [{"id": string, "likelihood": "high"|"medium"|"low", "why": string}], "causes": [string], "solutions": [{"text": string, "who": "diy"|"bengkel"}], "safety": "ok"|"caution"|"stop", "followUp": string|null}`;
}

function contextFor(text: string) {
  return retrieve(text, 5)
    .map((s) =>
      [
        `# ${s.title} (safety: ${s.safety})`,
        `komponen: ${s.parts.map((p) => `${p.id}=${p.likelihood}`).join(", ")}`,
        `penyebab: ${s.causes.join("; ")}`,
        s.checks?.length ? `cek: ${s.checks.join("; ")}` : "",
        `solusi: ${s.solutions.map((x) => `${x.text} [${x.who}]`).join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

const LIKELIHOOD: Likelihood[] = ["high", "medium", "low"];
const SAFETY: Safety[] = ["ok", "caution", "stop"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function clean(raw: unknown, fallback: Diagnosis): Diagnosis {
  const d = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const parts = (Array.isArray(d.parts) ? d.parts : [])
    .map((p) => p as Record<string, unknown>)
    .filter((p) => typeof p.id === "string" && PART_BY_ID.has(p.id) && !seen.has(p.id) && (seen.add(p.id), true))
    .slice(0, 6)
    .map((p) => ({
      id: p.id as string,
      likelihood: LIKELIHOOD.includes(p.likelihood as Likelihood) ? (p.likelihood as Likelihood) : "medium",
      why: str(p.why, 200),
    }));
  const causes = (Array.isArray(d.causes) ? d.causes : []).map((c) => str(c, 200)).filter(Boolean).slice(0, 6);
  const solutions = (Array.isArray(d.solutions) ? d.solutions : [])
    .map((s) => s as Record<string, unknown>)
    .map((s) => ({ text: str(s.text, 220), who: s.who === "diy" ? ("diy" as const) : ("bengkel" as const) }))
    .filter((s) => s.text)
    .slice(0, 6);
  const reply = str(d.reply, 600) || fallback.reply;
  const followUp = str(d.followUp, 200) || undefined;
  const safety = SAFETY.includes(d.safety as Safety) ? (d.safety as Safety) : fallback.safety;
  return {
    reply,
    parts: parts.length ? parts : fallback.parts,
    causes: causes.length ? causes : fallback.causes,
    solutions: solutions.length ? solutions : fallback.solutions,
    // never let the model downgrade a safety-critical match from the knowledge base
    safety: fallback.safety === "stop" ? "stop" : safety,
    followUp,
    source: "ai",
  };
}

export async function diagnose(turns: ChatTurn[]): Promise<Diagnosis> {
  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  // Ground on the latest message, plus earlier user messages for follow-ups like "iya, pas digas"
  const userText = turns.filter((t) => t.role === "user").slice(-3).map((t) => t.content).join(" \n ");
  const fallback = localDiagnosis(milCode(lastUser) !== null ? lastUser : userText);

  const key = process.env.AI_API_KEY;
  if (!key) return { ...fallback, reply: `${fallback.reply} (AI belum aktif; jawaban diambil dari data servis.)` };

  const body: Record<string, unknown> = {
    model: MODEL,
    temperature: 0.3,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: systemPrompt(contextFor(userText)) }, ...turns.slice(-8)],
  };
  if (MODEL.startsWith("qwen/")) body.reasoning_effort = "none";

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("AI error", res.status, detail.slice(0, 300));
      const why = res.status === 429 ? "Kuota AI sedang penuh" : "AI tidak dapat dihubungi";
      return { ...fallback, reply: `${fallback.reply} (${why}; jawaban diambil dari data servis.)` };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
    return clean(JSON.parse(text), fallback);
  } catch (e) {
    console.error("AI failure", e);
    return { ...fallback, reply: `${fallback.reply} (AI tidak merespons tepat waktu; jawaban diambil dari data servis.)` };
  }
}
