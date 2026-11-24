import type { Item, Project } from "./github";

export const STATUSES = ["Ready", "In progress", "In review", "Done"] as const;

export const status = (t: Item) => t.values["Status"] || "Ready";

/** "src/client/Aim/*, assets/a.yaml" -> ["src/client/aim/", "assets/a.yaml"] */
function patterns(files: string): string[] {
  return files
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase().replace(/\\/g, "/"))
    .filter(Boolean)
    .map((s) => s.replace(/\*+$/, ""));
}

/** Two Files fields overlap if any path equals or contains another (globs treated as folders). */
export function filesOverlap(a: string, b: string): boolean {
  const pa = patterns(a);
  const pb = patterns(b);
  return pa.some((x) => pb.some((y) => x === y || x.startsWith(y) || y.startsWith(x)));
}

/** In-progress tasks (other than `t`) whose Files overlap with `t`'s. */
export function overlaps(t: Item, tasks: Item[]): Item[] {
  const f = t.values["Files"];
  if (!f || status(t) === "Done") return [];
  return tasks.filter((o) => o.id !== t.id && status(o) === "In progress" && o.values["Files"] && filesOverlap(f, o.values["Files"]));
}

export const PILLS: Record<string, [string, string]> = {
  Approved: ["#E3F3EA", "#1E6B49"],
  "In Studio": ["#E7ECFB", "#2B44A8"],
  Generated: ["#FDF1DC", "#7A4B00"],
  Idea: ["#EFEDE8", "#5E5B55"],
};
export const pill = (s: string): [string, string] => PILLS[s] ?? ["#EFEDE8", "#5E5B55"];

export function plural(type: string): string {
  if (/music$/i.test(type) || /s$/i.test(type)) return type;
  return type + "s";
}

/** Assets at or past the third status ("In Studio") count as built/modelled. */
export function isBuilt(assetStatus: string, statuses: string[]): boolean {
  const i = statuses.indexOf(assetStatus);
  return i >= Math.min(2, statuses.length - 1);
}

export function replaceItem(p: Project, id: string, fn: (i: Item) => Item): Project {
  return { ...p, items: p.items.map((i) => (i.id === id ? fn(i) : i)) };
}
