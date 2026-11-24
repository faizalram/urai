"use client";

import { GROUP_LABEL, PARTS, type Group } from "@/lib/parts";

const ORDER: Group[] = ["mesin", "cvt", "bahanbakar", "listrik", "rem", "rangka", "bodi"];

export default function PartList({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  return (
    <div className="partlist">
      {ORDER.map((g) => (
        <section key={g}>
          <h4>{GROUP_LABEL[g]}</h4>
          <ul>
            {PARTS.filter((p) => p.group === g).map((p) => (
              <li key={p.id}>
                <button type="button" aria-pressed={selected === p.id} onClick={() => onPick(p.id)}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
