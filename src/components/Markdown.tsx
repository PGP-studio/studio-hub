import { type ReactNode } from "react";

/** Just enough markdown for prompts and descriptions: headings, paragraphs, bullets, checkboxes, **bold**, `code`, code blocks. */
export default function Markdown({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <b key={i}>{part.slice(2, -2)}</b>
      ) : part.startsWith("`") && part.endsWith("`") ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let fence: string[] | null = null;
  const flush = () => {
    if (bullets.length)
      blocks.push(
        <ul key={blocks.length}>
          {bullets.map((b, i) => {
            const box = b.match(/^\[( |x|X)\] (.*)$/);
            return (
              <li key={i} className={box ? "check" : undefined}>
                {box ? <input type="checkbox" checked={box[1] !== " "} readOnly /> : null}
                {inline(box ? box[2] : b)}
              </li>
            );
          })}
        </ul>,
      );
    bullets = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (fence) {
        blocks.push(<pre key={blocks.length}>{fence.join("\n")}</pre>);
        fence = null;
      } else {
        flush();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(<h4 key={blocks.length}>{inline(h[2])}</h4>);
    } else if (/^\s*[-*] /.test(line)) {
      bullets.push(line.replace(/^\s*[-*] /, ""));
    } else if (/^\s{2,}\S/.test(line) && bullets.length) {
      bullets[bullets.length - 1] += " " + line.trim(); // wrapped bullet
    } else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  if (fence) blocks.push(<pre key={blocks.length}>{fence.join("\n")}</pre>);
  flush();
  return <div className="md">{blocks}</div>;
}
