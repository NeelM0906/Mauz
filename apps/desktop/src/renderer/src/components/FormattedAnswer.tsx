import type { ReactNode } from "react";
import { parseFormattedAnswer, type FormattedAnswerBlock } from "@renderer/lib/formatAnswer";

export function FormattedAnswer({ answer }: { answer: string }): React.JSX.Element {
  const blocks = parseFormattedAnswer(answer);

  return (
    <div className="formatted-answer">
      {blocks.map((block, index) => (
        <AnswerBlock key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

function AnswerBlock({ block }: { block: FormattedAnswerBlock }): React.JSX.Element {
  if (block.type === "heading") {
    const Heading = `h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4";

    return <Heading>{renderInlineFormatting(block.text)}</Heading>;
  }

  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";

    return (
      <List>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineFormatting(item)}</li>
        ))}
      </List>
    );
  }

  if (block.type === "code") {
    return (
      <pre>
        {block.language === undefined ? null : <span className="code-language">{block.language}</span>}
        <code>{block.code}</code>
      </pre>
    );
  }

  return <p>{renderInlineFormatting(block.text)}</p>;
}

function renderInlineFormatting(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlinePattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const strongText = match[2] ?? match[3];
    const codeText = match[4];
    const key = `${match.index}-${match[0]}`;

    if (strongText !== undefined) {
      nodes.push(<strong key={key}>{strongText}</strong>);
    } else if (codeText !== undefined) {
      nodes.push(<code key={key}>{codeText}</code>);
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [text];
}
