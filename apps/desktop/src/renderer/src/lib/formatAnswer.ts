export type FormattedAnswerBlock =
  | {
      type: "heading";
      level: 1 | 2 | 3;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: string[];
    }
  | {
      type: "code";
      language?: string | undefined;
      code: string;
    };

export function parseFormattedAnswer(answer: string): FormattedAnswerBlock[] {
  const lines = answer.replace(/\r\n/g, "\n").split("\n");
  const blocks: FormattedAnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let codeFence: { language?: string | undefined; lines: string[] } | null = null;

  const flushParagraph = (): void => {
    const text = paragraph.join(" ").trim();

    if (text.length > 0) {
      blocks.push({
        type: "paragraph",
        text
      });
    }

    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== null && list.items.length > 0) {
      blocks.push({
        type: "list",
        ordered: list.ordered,
        items: list.items
      });
    }

    list = null;
  };

  for (const line of lines) {
    const codeFenceMatch = line.match(/^```(\S+)?\s*$/);

    if (codeFenceMatch !== null) {
      if (codeFence === null) {
        flushParagraph();
        flushList();
        codeFence = {
          language: codeFenceMatch[1],
          lines: []
        };
      } else {
        blocks.push({
          type: "code",
          language: codeFence.language,
          code: codeFence.lines.join("\n")
        });
        codeFence = null;
      }

      continue;
    }

    if (codeFence !== null) {
      codeFence.lines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch !== null) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: Math.min(headingMatch[1]?.length ?? 1, 3) as 1 | 2 | 3,
        text: headingMatch[2]?.trim() ?? ""
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (bulletMatch !== null || orderedMatch !== null) {
      flushParagraph();
      const ordered = orderedMatch !== null;
      const item = (bulletMatch?.[1] ?? orderedMatch?.[1] ?? "").trim();

      if (list === null || list.ordered !== ordered) {
        flushList();
        list = {
          ordered,
          items: []
        };
      }

      list.items.push(item);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  if (codeFence !== null) {
    blocks.push({
      type: "code",
      language: codeFence.language,
      code: codeFence.lines.join("\n")
    });
  }

  flushParagraph();
  flushList();

  return blocks;
}
