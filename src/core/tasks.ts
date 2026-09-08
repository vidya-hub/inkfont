import { rectify, detectMarkers } from "./worksheet";
import { compileFont, parseFont } from "./font";
import { traceImage } from "./trace";
import { fitContour, booleanContours, erase } from "./operations";
import { ribbonOutline } from "../lib/ink/ribbon";
import { fromLegacy } from "./conversion";

export function runTask(operation: string, payload: any): unknown {
  if (operation === "markers")
    return detectMarkers(payload.pixels, payload.width, payload.height);
  if (operation === "rectify")
    return rectify(
      payload.pixels,
      payload.width,
      payload.height,
      payload.markers,
    );
  if (operation === "compile") return compileFont(payload);
  if (operation === "parse") return parseFont(payload.buffer, payload.name);
  if (operation === "trace") return traceImage(payload);
  if (operation === "fit")
    return payload.contours.map((c: any) => fitContour(c, payload.tolerance));
  if (operation === "erase") return erase(payload.objects, payload.cut);
  if (operation === "union") return booleanContours(payload, []);
  if (operation === "brush") {
    const raw = ribbonOutline(
      payload.points.map((p: any) => ({ ...p, y: -p.y })),
      payload.settings,
    );
    return booleanContours([fromLegacy(raw, 0)], []).map((c) =>
      fitContour(c, payload.tolerance ?? 1),
    );
  }
  throw new Error("Unknown worker operation");
}
