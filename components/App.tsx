"use client";

import { useCallback, useRef, useState } from "react";
import Chat from "./Chat";
import PartCard from "./PartCard";
import PartList from "./PartList";
import Viewer, { type Highlight } from "./Viewer";
import type { Diagnosis } from "@/lib/retrieve";

export default function App() {
  const [explode, setExplode] = useState(0);
  const [xray, setXray] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 });
  const [tab, setTab] = useState<"chat" | "parts">("chat");
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  // Panel size: "wide" toggle for all screens, plus a drag width (px) on desktop
  const [wide, setWide] = useState(false);
  const [panelW, setPanelW] = useState<number | null>(null);
  const appRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const app = appRef.current;
    if (!app) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = app.getBoundingClientRect();
      const w = Math.min(Math.max(r.right - ev.clientX, 320), r.width - 280);
      setPanelW(w);
      setWide(false);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }, []);

  const focusOn = useCallback((ids: string[]) => setFocus((f) => ({ ids, n: f.n + 1 })), []);

  const onDiagnosis = useCallback(
    (d: Diagnosis) => {
      setHighlights(d.parts.map((p) => ({ id: p.id, likelihood: p.likelihood })));
      if (d.parts.length) {
        setSelected(null);
        // Parts stay where they sit on the bike; everything else turns see-through,
        // so hidden ones (rollers, kampas ganda) show without losing their location.
        // Frame the most likely parts together
        const top = d.parts.filter((p) => p.likelihood !== "low").slice(0, 3);
        focusOn((top.length ? top : d.parts.slice(0, 1)).map((p) => p.id));
      }
    },
    [focusOn],
  );

  const pickPart = useCallback(
    (id: string) => {
      setSelected(id);
      focusOn([id]);
    },
    [focusOn],
  );

  const askAbout = useCallback((text: string) => {
    setTab("chat");
    setAsk((a) => ({ text, n: (a?.n ?? 0) + 1 }));
  }, []);

  return (
    <div
      ref={appRef}
      className={`app${wide ? " app-wide" : ""}`}
      style={panelW && !wide ? ({ "--panel-w": `${panelW}px` } as React.CSSProperties) : undefined}
    >
      <main className="stage">
        <Viewer explode={explode} xray={xray} highlights={highlights} selected={selected} focus={focus} onSelect={setSelected} />

        <header className="brand">
          <span className="logo">Urai</span>
          <span className="model">Honda BeAT · rangka eSAF 2020+</span>
        </header>

        {selected && <PartCard id={selected} onClose={() => setSelected(null)} onAsk={askAbout} onFocus={(id) => focusOn([id])} />}

        <div className="controls" role="toolbar" aria-label="Kontrol model">
          <button
            type="button"
            className="ctl ctl-main"
            onClick={() => {
              const next = explode > 0.3 ? 0 : 1;
              setExplode(next);
              setSelected(null);
              // reset after state applies so the camera uses the new spread
              setTimeout(() => focusOn([]), 0);
            }}
          >
            {explode > 0.3 ? "Rakit" : "Urai"}
          </button>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(explode * 100)}
            onChange={(e) => setExplode(+e.target.value / 100)}
            aria-label="Tingkat urai"
          />
          <button type="button" className="ctl" aria-pressed={xray} onClick={() => setXray((x) => !x)}>
            Mode X-ray
          </button>
          <button type="button" className="ctl" onClick={() => focusOn([])}>
            Reset kamera
          </button>
          {highlights.length > 0 && (
            <button type="button" className="ctl" onClick={() => setHighlights([])}>
              Hapus highlight
            </button>
          )}
        </div>
      </main>

      <section className="panel">
        <div
          className="panel-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ubah lebar panel"
          onPointerDown={startDrag}
          onDoubleClick={() => setPanelW(null)}
        />
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
            Diagnosa
          </button>
          <button type="button" role="tab" aria-selected={tab === "parts"} onClick={() => setTab("parts")}>
            Komponen
          </button>
          <button
            type="button"
            className="panel-expand"
            aria-pressed={wide}
            onClick={() => {
              setWide((w) => !w);
              setPanelW(null);
            }}
            title={wide ? "Perkecil panel" : "Perbesar panel"}
          >
            {wide ? "Perkecil" : "Perbesar"}
          </button>
        </div>
        <div className="panel-body" hidden={tab !== "chat"}>
          <Chat ask={ask} onDiagnosis={onDiagnosis} onFocusPart={pickPart} />
        </div>
        <div className="panel-body panel-scroll" hidden={tab !== "parts"}>
          <PartList selected={selected} onPick={pickPart} />
        </div>
      </section>
    </div>
  );
}
