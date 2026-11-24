"use client";

import { useEffect, useRef, useState } from "react";
import { PART_BY_ID } from "@/lib/parts";
import type { Diagnosis } from "@/lib/retrieve";

type Msg = { role: "user" | "assistant"; text: string; d?: Diagnosis; error?: boolean };

const QUICK = [
  "Gredek pas mulai jalan",
  "Mesin brebet saat digas",
  "Tombol starter tidak bereaksi",
  "Lampu injeksi kedip 12 kali",
  "Bunyi kletek dari CVT",
  "Rem depan kurang pakem",
  "Bensin boros",
];

const LIK_LABEL = { high: "Paling mungkin", medium: "Mungkin", low: "Cek juga" } as const;

type Props = {
  ask: { text: string; n: number } | null;
  onDiagnosis: (d: Diagnosis) => void;
  onFocusPart: (id: string) => void;
};

export default function Chat({ ask, onDiagnosis, onFocusPart }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const last = el.lastElementChild as HTMLElement | null;
    // Show the start of a new answer (safety note and summary), not its end
    if (!busy && last?.classList.contains("msg-ai")) el.scrollTo({ top: last.offsetTop - 12, behavior: "smooth" });
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgsRef.current, { role: "user", text: content }];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.text })) }),
        signal: AbortSignal.timeout(45_000),
      });
      const data = (await res.json().catch(() => ({}))) as Diagnosis & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Gagal (${res.status})`);
      setMsgs((m) => [...m, { role: "assistant", text: data.reply, d: data }]);
      onDiagnosis(data);
    } catch (e) {
      const msg = (e as Error).name === "TimeoutError" ? "Terlalu lama menunggu jawaban. Coba lagi." : (e as Error).message || "Koneksi bermasalah.";
      setMsgs((m) => [...m, { role: "assistant", text: msg, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ask) send(ask.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  return (
    <div className="chat">
      <div className="chat-list" ref={list} aria-live="polite" style={{ position: "relative" }}>
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p className="chat-hello">Motor kenapa? Ceritakan gejalanya seperti ke mekanik: kapan terjadi, bunyinya, dan apakah lampu injeksi berkedip.</p>
            <div className="quick">
              {QUICK.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg msg-user">
              {m.text}
            </div>
          ) : (
            <div key={i} className={`msg msg-ai${m.error ? " msg-error" : ""}`}>
              {m.d ? <DiagnosisView d={m.d} onFocusPart={onFocusPart} /> : m.text}
            </div>
          ),
        )}
        {busy && (
          <div className="msg msg-ai msg-typing" aria-label="Sedang menganalisis">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          placeholder="Contoh: motor bergetar pas mulai jalan, apalagi habis hujan"
          rows={2}
          maxLength={1500}
          aria-label="Keluhan motor"
        />
        <button type="submit" className="send" disabled={busy || !text.trim()}>
          Kirim
        </button>
      </form>
    </div>
  );
}

function DiagnosisView({ d, onFocusPart }: { d: Diagnosis; onFocusPart: (id: string) => void }) {
  return (
    <div className="diag">
      {d.safety === "stop" && <div className="safety safety-stop">Jangan dipakai dulu sampai diperiksa. Ini menyangkut keselamatan.</div>}
      {d.safety === "caution" && <div className="safety safety-caution">Masih bisa jalan pelan ke bengkel, tapi jangan ditunda.</div>}
      <p className="diag-reply">{d.reply}</p>

      {d.parts.length > 0 && (
        <section>
          <h4>Komponen yang dicurigai</h4>
          <ol className="suspects">
            {d.parts.map((p) => (
              <li key={p.id}>
                <button type="button" className={`suspect suspect-${p.likelihood}`} onClick={() => onFocusPart(p.id)}>
                  <span className="suspect-name">{PART_BY_ID.get(p.id)?.name ?? p.id}</span>
                  <span className="suspect-lik">{LIK_LABEL[p.likelihood]}</span>
                  {p.why && <span className="suspect-why">{p.why}</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {d.causes.length > 0 && (
        <section>
          <h4>Kemungkinan penyebab</h4>
          <ul className="plain">
            {d.causes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {d.solutions.length > 0 && (
        <section>
          <h4>Yang bisa dilakukan</h4>
          <ul className="fixes">
            {d.solutions.map((s, i) => (
              <li key={i}>
                <span className={`who who-${s.who}`}>{s.who === "diy" ? "Sendiri" : "Bengkel"}</span>
                {s.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.followUp && <p className="followup">{d.followUp}</p>}
      <p className="source">{d.source === "ai" ? "Dijawab AI, berdasar basis pengetahuan BeAT" : "Dari basis pengetahuan BeAT"}</p>
    </div>
  );
}
