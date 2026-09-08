import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useDocument } from "../core/store";
import {
  uid,
  identity,
  makeGlyph,
  type FontProject,
  type Contour,
} from "../core/model";
import { cloneContours, pathData } from "../core/geometry";
import { runJob } from "../core/jobs";
export function ImportDialog({ close }: { close: () => void }) {
  const [font, setFont] = useState<FontProject | null>(null),
    [image, setImage] = useState<{
      url: string;
      width: number;
      height: number;
      pixels: Uint8ClampedArray;
      name: string;
    } | null>(null),
    [outlines, setOutlines] = useState<Contour[] | null>(null),
    [threshold, setThreshold] = useState(150),
    [detail, setDetail] = useState(1),
    [noise, setNoise] = useState(0),
    [mode, setMode] = useState<"copy" | "reference">("reference"),
    [conflict, setConflict] = useState<"missing" | "replace" | "merge">(
      "missing",
    ),
    [characters, setCharacters] = useState(""),
    [adopt, setAdopt] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const read = async (file: File) => {
    abort.current?.abort();
    abort.current = new AbortController();
    const signal = abort.current.signal;
    setBusy(true);
    setError("");
    setFont(null);
    setImage(null);
    setOutlines(null);
    try {
      if (file.size > 24 * 1024 * 1024)
        throw new Error("Choose a file smaller than 24 MB.");
      if (/\.(ttf|otf|woff)$/i.test(file.name)) {
        const p = await runJob<FontProject>(
          "parse",
          { buffer: await file.arrayBuffer(), name: file.name },
          0,
          signal,
        );
        if (signal.aborted) return;
        setFont(p);
        setCharacters(Object.keys(p.mappings).join(""));
      } else if (/image\/(png|jpeg|webp)/.test(file.type)) {
        const bitmap = await createImageBitmap(file);
        if (bitmap.width * bitmap.height > 16000000) {
          bitmap.close();
          throw new Error("Use an image below 16 megapixels.");
        }
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        if (signal.aborted) return;
        setImage({
          url: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
          pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          name: file.name,
        });
      } else throw new Error("Choose TTF, OTF, WOFF, PNG, JPEG, or WebP.");
    } catch (err) {
      if (!signal.aborted) setError((err as Error).message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };
  const trace = async () => {
    if (!image) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setError("");
    try {
      setOutlines(
        await runJob<Contour[]>(
          "trace",
          {
            pixels: image.pixels,
            width: image.width,
            height: image.height,
            threshold,
            tolerance: detail,
            noise,
          },
          0,
          abort.current.signal,
        ),
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const accept = () => {
    try {
      const state = useDocument.getState();
      if (font) {
        const chosen = new Set(Array.from(characters));
        state.edit("Import font", (p) => {
          const glyphs = { ...p.glyphs },
            mappings = { ...p.mappings };
          for (const [ch, sourceId] of Object.entries(font.mappings)) {
            if (!chosen.has(ch)) continue;
            const source = font.glyphs[sourceId],
              existing = mappings[ch],
              g = existing ? glyphs[existing] : makeGlyph(ch);
            if (conflict === "missing" && g.objects.length) continue;
            const cs = cloneContours(source.objects.flatMap((o) => o.contours));
            if (mode === "reference") {
              glyphs[g.id] = {
                ...g,
                references: [
                  ...g.references,
                  {
                    id: uid(),
                    name: font.name + " " + ch,
                    contours: cs,
                    opacity: 0.22,
                    visible: true,
                    locked: true,
                    transform: identity(),
                  },
                ],
              };
            } else
              glyphs[g.id] = {
                ...g,
                advance: source.advance,
                objects: [
                  ...(conflict === "merge" ? g.objects : []),
                  ...(cs.length ? [{ id: uid(), contours: cs }] : []),
                ],
              };
            mappings[ch] = g.id;
          }
          return {
            ...p,
            glyphs,
            mappings,
            metrics: adopt ? font.metrics : p.metrics,
          };
        });
      } else if (image) {
        const id = state.selected;
        if (!id) throw new Error("Select a glyph first.");
        state.edit(
          outlines ? "Accept traced image" : "Add image reference",
          (p) => ({
            ...p,
            glyphs: {
              ...p.glyphs,
              [id]: {
                ...p.glyphs[id],
                references: [
                  ...p.glyphs[id].references,
                  {
                    id: uid(),
                    name: image.name,
                    image: image.url,
                    width: (700 * image.width) / image.height,
                    height: 700,
                    opacity: 0.25,
                    visible: true,
                    locked: true,
                    transform: [1, 0, 0, 1, 60, 0],
                  },
                ],
                objects: [
                  ...p.glyphs[id].objects,
                  ...(outlines ? [{ id: uid(), contours: outlines }] : []),
                ],
              },
            },
          }),
        );
      }
      close();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title="Import & trace" onClose={close} wide>
      <p>
        Font outlines can be edited directly. Images become locked references
        with optional local vector tracing.
      </p>
      <label className="drop-zone">
        Choose a font or image
        <input
          aria-label="Import file"
          type="file"
          accept=".ttf,.otf,.woff,.png,.jpg,.jpeg,.webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
      </label>
      {busy && (
        <p role="status">
          Processing on your device…{" "}
          <button
            onClick={() => {
              abort.current?.abort();
              setBusy(false);
            }}
          >
            Cancel
          </button>
        </p>
      )}
      {font && (
        <>
          <h3>{font.name}</h3>
          <p>
            {Object.keys(font.mappings).length} mapped characters · Imported
            curves remain editable.
          </p>
          <label>
            Characters to include
            <textarea
              value={characters}
              onChange={(e) => setCharacters(e.target.value)}
            />
          </label>
          <label>
            Use source as
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="reference">Locked tracing reference</option>
              <option value="copy">Editable font outlines</option>
            </select>
          </label>
          <label>
            Existing glyphs
            <select
              value={conflict}
              onChange={(e) => setConflict(e.target.value as typeof conflict)}
            >
              <option value="missing">Fill missing only</option>
              <option value="replace">Replace outlines</option>
              <option value="merge">Merge outlines</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={adopt}
              onChange={(e) => setAdopt(e.target.checked)}
            />
            Adopt source font metrics
          </label>
          <p className="muted">
            Outline import does not retain the source font’s shaping rules or
            variable-font axes.
          </p>
        </>
      )}
      {image && (
        <>
          <div className="trace-preview">
            <img src={image.url} alt="Source for tracing" />
            {outlines && (
              <svg
                viewBox={`0 -700 ${(700 * image.width) / image.height + 120} 700`}
              >
                <g fill="#c6532b" fillOpacity=".7">
                  {outlines.map((c) => (
                    <path key={c.id} d={pathData(c)} />
                  ))}
                </g>
              </svg>
            )}
          </div>
          <div className="two-fields">
            <label>
              Threshold
              <input
                type="range"
                min="10"
                max="245"
                value={threshold}
                onChange={(e) => {
                  setThreshold(+e.target.value);
                  setOutlines(null);
                }}
              />
            </label>
            <label>
              Curve tolerance
              <input
                type="number"
                min="0"
                max="5"
                step=".25"
                value={detail}
                onChange={(e) => {
                  setDetail(Math.max(0, Math.min(5, +e.target.value)));
                  setOutlines(null);
                }}
              />
            </label>
            <label>
              Remove regions below (pixels)
              <input
                type="number"
                min="0"
                value={noise}
                onChange={(e) => {
                  setNoise(Math.max(0, +e.target.value));
                  setOutlines(null);
                }}
              />
            </label>
          </div>
          <p className="muted">
            Cleanup defaults to zero to preserve dots, accents, and holes.
            Review the overlay before accepting.
          </p>
          <button disabled={busy} onClick={() => void trace()}>
            Auto-trace image
          </button>
          {outlines && (
            <p>
              {outlines.length} contours ·{" "}
              {outlines.reduce((n, c) => n + c.nodes.length, 0)} editable nodes
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={busy || (!font && !image)}
          onClick={accept}
        >
          {image
            ? outlines
              ? "Accept vectors & reference"
              : "Add reference"
            : mode === "copy"
              ? "Copy editable outlines"
              : "Add tracing references"}
        </button>
      </footer>
    </Modal>
  );
}
