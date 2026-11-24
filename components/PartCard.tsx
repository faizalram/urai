"use client";

import { GROUP_LABEL, PART_BY_ID } from "@/lib/parts";
import { SYMPTOMS } from "@/lib/symptoms";

type Props = { id: string; onClose: () => void; onAsk: (text: string) => void; onFocus: (id: string) => void };

export default function PartCard({ id, onClose, onAsk, onFocus }: Props) {
  const p = PART_BY_ID.get(id);
  if (!p) return null;
  const related = SYMPTOMS.filter((s) => s.parts.some((x) => x.id === id))
    .sort((a, b) => Number(!!a.mil) - Number(!!b.mil))
    .slice(0, 4);
  return (
    <aside className="partcard" aria-label={p.name}>
      <div className="partcard-head">
        <div>
          <p className="partcard-group">{GROUP_LABEL[p.group]}</p>
          <h3>{p.name}</h3>
          <p className="partcard-en">{p.en}</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">
          ×
        </button>
      </div>
      <div className="partcard-body">
        <p>{p.what}</p>
        <p className="partcard-where">
          <strong>Letak:</strong> {p.where}
        </p>
        {p.specs && (
          <ul className="specs">
            {p.specs.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        {related.length > 0 && (
          <div className="related">
            <p className="related-title">Keluhan terkait</p>
            <div className="quick">
              {related.map((s) => (
                <button key={s.id} type="button" className="chip" onClick={() => onAsk(s.title)}>
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="link-btn" onClick={() => onFocus(id)}>
          Dekatkan kamera
        </button>
      </div>
    </aside>
  );
}
