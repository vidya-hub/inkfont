import { useRef, useState, useEffect } from "react";
import { Modal } from "./Modal";
import { useDocument } from "../core/store";
import { download } from "../core/repository";
import { sheet } from "../core/worksheet";
import { uid, makeGlyph, type Point, type Contour } from "../core/model";
import { runJob } from "../core/jobs";
import { pathData } from "../core/geometry";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function WorksheetDialog({ close }: { close: () => void }) {
  const [chars, setChars] = useState("ABCDEFGHIJKLMNOPQRSTUVWXYZabcd"),
    [photo, setPhoto] = useState<{
      url: string;
      pixels: Uint8ClampedArray;
      width: number;
      height: number;
    } | null>(null),
    [markers, setMarkers] = useState<Point[]>([]),
    [cells, setCells] = useState<
      { char: string; contours: Contour[]; accepted: boolean }[]
    >([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [threshold, setThreshold] = useState(130),
    [inset, setInset] = useState(8),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const letters = Array.from(chars).slice(0, 30);
  const print = () => {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100"><rect width="800" height="1100" fill="white"/><text x="60" y="60" font-family="sans-serif" font-size="20">Inkfont · handwriting worksheet</text><text x="60" y="82" font-family="sans-serif" font-size="11">Draw inside each box. Keep all four black markers visible in your photo.</text>`;
    for (const p of sheet.markers)
      svg += `<rect x="${p.x - 8}" y="${p.y - 8}" width="16" height="16"/>`;
    letters.forEach((c, i) => {
      const x = sheet.left + (i % 5) * sheet.cw,
        y = sheet.top + Math.floor(i / 5) * sheet.ch;
      svg += `<g><rect x="${x}" y="${y}" width="${sheet.cw - 8}" height="${sheet.ch - 8}" fill="none" stroke="#ddd"/><text x="${x + 6}" y="${y + 17}" font-size="13" font-family="sans-serif">${escape(c)} · ${i + 1}</text><path d="M${x + 6} ${y + 110}H${x + sheet.cw - 14}" stroke="#ddd"/><path d="M${x + 6} ${y + 52}H${x + sheet.cw - 14}" stroke="#eee"/></g>`;
    });
    svg += "</svg>";
    download(svg, "inkfont-worksheet.svg", "image/svg+xml");
  };
  const read = async (f: File) => {
    try {
      if (f.size > 24 * 1024 * 1024) throw new Error("Image exceeds 24 MB.");
      setBusy(true);
      const bitmap = await createImageBitmap(f);
      if (bitmap.width * bitmap.height > 16000000) {
        bitmap.close();
        throw new Error("Image exceeds 16 megapixels.");
      }
      const c = document.createElement("canvas");
      const s = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      c.width = Math.round(bitmap.width * s);
      c.height = Math.round(bitmap.height * s);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      setPhoto({
        url: c.toDataURL("image/png"),
        pixels: data,
        width: c.width,
        height: c.height,
      });
      abort.current = new AbortController();
      const found = await runJob<Point[]>(
        "markers",
        { pixels: data, width: c.width, height: c.height },
        0,
        abort.current.signal,
      );
      setMarkers(found);
      setCells([]);
      setStatus(
        found.length === 4
          ? "Markers detected. Verify them before extracting."
          : "Click the four markers: top-left, top-right, bottom-right, bottom-left.",
      );
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const extract = async () => {
    if (!photo || markers.length !== 4) return;
    setBusy(true);
    setStatus("Aligning worksheet…");
    abort.current = new AbortController();
    try {
      const pixels = await runJob<Uint8ClampedArray>(
          "rectify",
          { ...photo, markers },
          0,
          abort.current.signal,
        ),
        result: typeof cells = [];
      for (let i = 0; i < letters.length; i++) {
        setStatus(`Tracing cell ${i + 1} of ${letters.length}…`);
        const x = sheet.left + (i % 5) * sheet.cw + inset,
          y = sheet.top + Math.floor(i / 5) * sheet.ch + 25,
          w = sheet.cw - 8 - inset * 2,
          h = sheet.ch - 33 - inset,
          data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++)
          data.set(
            pixels.subarray(
              ((y + row) * sheet.width + x) * 4,
              ((y + row) * sheet.width + x + w) * 4,
            ),
            row * w * 4,
          );
        const contours = await runJob<Contour[]>(
          "trace",
          {
            pixels: data,
            width: w,
            height: h,
            threshold,
            tolerance: 1,
            noise: 0,
          },
          0,
          abort.current.signal,
        );
        result.push({
          char: letters[i],
          contours,
          accepted: contours.length > 0,
        });
      }
      setCells(result);
      setStatus(
        "Review every cell. Uncheck empty or incorrect results; adjust crop inset or threshold and retry when needed.",
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Paper to font" onClose={close} wide>
      <p>
        Download the SVG worksheet and print it at any size. Use the same
        character order when loading its photo.
      </p>
      <label>
        Up to 30 characters
        <input
          value={chars}
          onChange={(e) => {
            setChars(Array.from(e.target.value).slice(0, 30).join(""));
            setCells([]);
          }}
        />
      </label>
      <div className="button-row">
        <button onClick={print}>Download printable worksheet</button>
        <label className="file-button">
          <span aria-hidden>Load worksheet photo</span>
          <input
            aria-label="Load worksheet photo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              if (e.target.files?.[0]) void read(e.target.files[0]);
            }}
          />
        </label>
      </div>
      {photo && (
        <>
          <div
            className="worksheet-photo"
            onClick={(e) => {
              if (markers.length >= 4) return;
              const r = e.currentTarget.getBoundingClientRect();
              setMarkers([
                ...markers,
                {
                  x: ((e.clientX - r.left) / r.width) * photo.width,
                  y: ((e.clientY - r.top) / r.height) * photo.height,
                },
              ]);
            }}
          >
            <img src={photo.url} alt="Worksheet with registration markers" />
            {markers.map((p, i) => (
              <span
                key={i}
                style={{
                  left: (p.x / photo.width) * 100 + "%",
                  top: (p.y / photo.height) * 100 + "%",
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <button
            onClick={() => {
              setMarkers([]);
              setCells([]);
              setStatus(
                "Click top-left, top-right, bottom-right, bottom-left markers.",
              );
            }}
          >
            Set markers manually
          </button>
          <div className="two-fields">
            <label>
              Threshold
              <input
                type="number"
                min="1"
                max="240"
                value={threshold}
                onChange={(e) =>
                  setThreshold(Math.max(1, Math.min(240, +e.target.value)))
                }
              />
            </label>
            <label>
              Crop inset
              <input
                type="number"
                min="2"
                max="30"
                value={inset}
                onChange={(e) =>
                  setInset(
                    Math.max(2, Math.min(30, Math.round(+e.target.value))),
                  )
                }
              />
            </label>
          </div>
          <button
            disabled={busy || markers.length !== 4}
            onClick={() => void extract()}
          >
            Align & extract cells
          </button>
        </>
      )}
      {busy && (
        <button
          onClick={() => {
            abort.current?.abort();
            setBusy(false);
          }}
        >
          Cancel processing
        </button>
      )}
      <p role="status">{status}</p>
      <div className="worksheet-cells">
        {cells.map((c, i) => (
          <label key={i}>
            <svg viewBox="0 -800 1000 1100">
              <path d={c.contours.map(pathData).join(" ")} fill="#242820" />
            </svg>
            <input
              type="checkbox"
              checked={c.accepted}
              onChange={(e) =>
                setCells(
                  cells.map((v, j) =>
                    i === j ? { ...v, accepted: e.target.checked } : v,
                  ),
                )
              }
            />
            {c.char}
            {!c.contours.length ? " · empty" : ""}
          </label>
        ))}
      </div>
      <footer>
        <button onClick={close}>Close</button>
        <button
          className="primary"
          disabled={busy || !cells.some((c) => c.accepted)}
          onClick={() => {
            useDocument.getState().edit("Import worksheet", (p) => {
              const glyphs = { ...p.glyphs },
                mappings = { ...p.mappings };
              for (const cell of cells.filter((c) => c.accepted)) {
                const g = glyphs[mappings[cell.char]] ?? makeGlyph(cell.char);
                glyphs[g.id] = {
                  ...g,
                  objects: [{ id: uid(), contours: cell.contours }],
                };
                mappings[cell.char] = g.id;
              }
              return { ...p, glyphs, mappings };
            });
            close();
          }}
        >
          Replace accepted glyphs
        </button>
      </footer>
    </Modal>
  );
}
