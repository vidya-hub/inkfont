/** Legacy brush/migration adapter types. Editable documents use core/model.ts. */
export interface StrokePoint { x:number;y:number;pressure:number }
export interface Stroke { points:StrokePoint[];width:number }
