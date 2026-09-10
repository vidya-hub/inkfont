import { useEffect, useRef, useState } from "react";
import { useDocument } from "../core/store";
import { resolveObjects } from "../core/geometry";
import { Modal } from "./Modal";
import { runJob } from "../core/jobs";
export function Proof() {
  const p = useDocument((s) => s.project),
    select = useDocument((s) => s.select),
    edit = useDocument((s) => s.edit),
    [text, setText] = useState("The quick brown fox jumps over the lazy dog."),
    [size, setSize] = useState(42),
    [large, setLarge] = useState(72),
    [status, setStatus] = useState(""),
    [pair, setPair] = useState("AV"),
    [preview, setPreview] = useState(false),
    face = useRef<FontFace | null>(null),
    [family, setFamily] = useState("");
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
  const hasInk = (ch: string) => {
    const g = p.glyphs[p.mappings[ch]];
    return !!g && resolveObjects(p, g.id).some((o) => o.contours.length > 0);
  };
  const renderSample = (sample: string, px: number, keyPrefix: string) => (
    <>
      {Array.from(sample).map((ch, i) =>
        ch === " " ? (
          <span key={keyPrefix + i}>{"\u00a0"}</span>
        ) : hasInk(ch) && family ? (
          <span key={keyPrefix + i} style={{ fontFamily: `"${family}"` }}>
            {ch}
          </span>
        ) : (
          <span
            key={keyPrefix + i}
            className="missing-glyph"
            style={{ fontSize: px }}
            title={"Missing outline: " + ch}
          >
            {ch}
          </span>
        ),
      )}
    </>
  );
  const missing = [...new Set(Array.from(text))].filter(
    (c) => !/^\s$/.test(c) && !hasInk(c),
  );
  const chars = Array.from(pair),
    a = p.mappings[chars[0]],
    b = p.mappings[chars[1]],
    key = a + "|" + b,
    pairReady =
      chars.length === 2 && a && b && hasInk(chars[0]) && hasInk(chars[1]);
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
        <button onClick={() => setPreview(true)}>Preview</button>
      </div>
      <div className="proof-text" style={{ fontSize: size }}>
        {text ? (
          renderSample(text, size, "s")
        ) : (
          <span className="muted">Type a word above</span>
        )}
      </div>
      <div className="proof-characters">
        {[...new Set(Array.from(text))]
          .filter((c) => !/^\s$/.test(c))
          .map((c) => {
            const g = p.glyphs[p.mappings[c]],
              empty = !g || !hasInk(c);
            return (
              <button
                key={c}
                className={empty ? "missing" : ""}
                title={empty ? "Missing outline: " + c : "Edit " + c}
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
        {pairReady && family ? (
          <span style={{ fontFamily: `"${family}"`, fontSize: 36 }}>
            {pair}
          </span>
        ) : (
          <small>Draw both letters to preview their spacing.</small>
        )}
        <small>Pair spacing is included in OTF export.</small>
      </div>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {preview && (
        <Modal title="Font preview" onClose={() => setPreview(false)} wide>
          <label>
            Size
            <input
              aria-label="Preview size"
              type="range"
              min="24"
              max="160"
              value={large}
              onChange={(e) => setLarge(+e.target.value)}
            />
          </label>
          <div className="preview-sample" style={{ fontSize: large }}>
            {text ? (
              renderSample(text, large, "p")
            ) : (
              <span className="muted">Type a word above</span>
            )}
          </div>
          {missing.length > 0 && (
            <>
              <p className="muted">
                Dashed letters have no ink yet. Select one to draw it.
              </p>
              <div className="proof-characters">
                {missing.map((c) => (
                  <button
                    key={c}
                    className="missing"
                    title={"Draw " + c}
                    onClick={() => {
                      const g = p.glyphs[p.mappings[c]];
                      if (g) select(g.id);
                      setPreview(false);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
          <footer>
            <button onClick={() => setPreview(false)}>Close</button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
