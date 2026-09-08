import { create } from "zustand";
import type { Point, Contour, PathObject } from "../core/model";
export type Tool =
  | "select"
  | "node"
  | "bezier"
  | "brush"
  | "eraser"
  | "rectangle"
  | "ellipse"
  | "hand";
interface EditorState {
  tool: Tool;
  selection: string[];
  nodes: string[];
  pivot: Point | null;
  size: number;
  stabilization: number;
  brush: "pen" | "brush" | "nib" | "monoline" | "chisel";
  nibAngle: number;
  taper: number;
  outline: boolean;
  snap: boolean;
  draft: PathObject[] | null;
  pen: Contour | null;
  fit: number;
  busy: boolean;
  set: (v: Partial<EditorState>) => void;
}
export const useEditor = create<EditorState>((set) => ({
  tool: "select",
  selection: [],
  nodes: [],
  pivot: null,
  size: 28,
  stabilization: 0.3,
  brush: "pen",
  nibAngle: 40,
  taper: 0.5,
  outline: false,
  snap: true,
  draft: null,
  pen: null,
  fit: 0,
  busy: false,
  set,
}));
