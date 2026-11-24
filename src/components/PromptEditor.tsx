import { useState } from "react";
import Markdown from "./Markdown";

// Same format as docs/task-prompt.md in the game repos: the prompt Claude follows for /task and /workflow.
export const TASK_TEMPLATE = `## Goal
One or two sentences: what this task delivers and why.

## Details
- What exactly to build: behaviour, numbers, names, UI text.
- Where the design lives (e.g. design/economy.xlsx, sheet "Guns").
- Constraints.

## Done when
- [ ] A check that proves it works, ideally in a playtest.
- [ ] Selene and StyLua pass.

## Files
src/...

## Not in scope
What to leave for other tasks.
`;

export const WORKFLOW_TEMPLATE = `## Goal
What this feature adds to the game, in a few sentences.

## Order
Why the tasks are in this order; what each one unblocks.

## Rules for every task
- Constraints every task in this workflow must respect.
`;

const PLACEHOLDERS = ["created from the hub.", "a workflow: its tasks are the sub-issues below."];

/** Issue bodies the hub writes by default don't count as prompts. */
export function promptOf(body: string): string {
  const b = body.trim();
  return PLACEHOLDERS.includes(b.toLowerCase()) ? "" : b;
}

/** Write / Preview tabs for a task's or workflow's prompt (its issue description). */
export default function PromptEditor({
  value,
  onChange,
  template,
  label = "Prompt",
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  template: string;
  label?: string;
  hint?: string;
}) {
  const [tab, setTab] = useState<"write" | "preview">(value ? "preview" : "write");
  return (
    <div className="form-row">
      <div className="prompt-head">
        <span>{label}</span>
        <div className="seg">
          <button type="button" className={tab === "write" ? "on" : ""} onClick={() => setTab("write")}>
            Write
          </button>
          <button type="button" className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>
            Preview
          </button>
          {!value.trim() ? (
            <button
              type="button"
              onClick={() => {
                onChange(template);
                setTab("write");
              }}
            >
              Use template
            </button>
          ) : null}
        </div>
      </div>
      {tab === "write" ? (
        <textarea className="input mono prompt-text" rows={14} value={value} onChange={(e) => onChange(e.target.value)} placeholder="No prompt yet. Click “Use template”." />
      ) : (
        <div className="prompt-preview">{value.trim() ? <Markdown text={value} /> : <p className="empty">No prompt yet.</p>}</div>
      )}
      {hint ? <span className="small">{hint}</span> : null}
    </div>
  );
}
