import { useEffect, useRef, useState } from "react";
import { useDocument } from "../core/store";
import { runJob } from "../core/jobs";
export function Proof() {
  const p = useDocument((s) => s.project),
    select = useDocument((s) => s.select),
    edit = useDocument((s) => s.edit),
    [text, setText] = useState("The quick brown fox jumps over the lazy dog."),
    [size, setSize] = useState(42),
    [status, setStatus] = useState(""),
    [pair, setPair] = useState("AV"),
    face = useRef<FontFace | null>(null),
    [family, setFamily] = useState("serif");
  useEffect(() => {
    const abort = new AbortController();
    setStatus("Updating proof…");
    const timer = setTimeout(async () => {
      try {
        const buffer = await runJob<ArrayBuffer>(
          "compile",
          p,
          p.revision,
          abort.signal,
        );
        const name = "Inkfont" + p.revision + "_" + Date.now(),
          loaded = await new FontFace(name, buffer).load();
        if (abort.signal.aborted) return;
        document.fonts.add(loaded);
        if (face.current) document.fonts.delete(face.current);
        face.current = loaded;
        setFamily(name);
        setStatus("");
      } catch (err) {
        if (!abort.signal.aborted) setStatus((err as Error).message);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [p]);
  useEffect(
    () => () => {
      if (face.current) document.fonts.delete(face.current);
    },
    [],
  );
  const chars = Array.from(pair),
    a = p.mappings[chars[0]],
    b = p.mappings[chars[1]],
    key = a + "|" + b;
  return (
    <section className="proof">
      <div className="proof-header">
        <strong>WORD PROOF</strong>
        <input
          aria-label="Proof text"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <label>
          Size
          <input
            aria-label="Proof size"
            type="range"
            min="18"
            max="100"
            value={size}
            onChange={(e) => setSize(+e.target.value)}
          />
        </label>
      </div>
      <div
        className="proof-text"
        style={{ fontFamily: `"${family}",serif`, fontSize: size }}
      >
        {text || "Type a word above"}
      </div>
      <div className="proof-characters">
        {[...new Set(Array.from(text))]
          .filter((c) => !/^\s$/.test(c))
          .map((c) => {
            const g = p.glyphs[p.mappings[c]],
              missing = !g || (!g.objects.length && !g.components.length);
            return (
              <button
                key={c}
                className={missing ? "missing" : ""}
                title={missing ? "Missing outline: " + c : "Edit " + c}
                onClick={() => g && select(g.id)}
              >
                {c}
              </button>
            );
          })}
      </div>
      <div className="pair-row">
        <label>
          Pair
          <input
            aria-label="Kerning pair"
            value={pair}
            onChange={(e) =>
              setPair(Array.from(e.target.value).slice(0, 2).join(""))
            }
          />
        </label>
        <label>
          Adjustment
          <input
            aria-label="Pair adjustment"
            type="number"
            disabled={!a || !b}
            value={p.kerning[key] ?? 0}
            onChange={(e) =>
              edit("Adjust pair spacing", (p) => ({
                ...p,
                kerning: { ...p.kerning, [key]: +e.target.value },
              }))
            }
          />
        </label>
        <span style={{ fontFamily: `"${family}",serif`, fontSize: 36 }}>
          {pair}
        </span>
        <small>Pair spacing is included in OTF export.</small>
      </div>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
