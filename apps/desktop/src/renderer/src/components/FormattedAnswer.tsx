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

    return <Heading>{block.text}</Heading>;
  }

  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";

    return (
      <List>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
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

  return <p>{block.text}</p>;
}
