import { Eye } from "lucide-react";
import type { MauzDesktopContext } from "@mauzai/shared";
import { describeCapture } from "@renderer/lib/cursorTarget";

/** Collapsed "What Mauz saw" list: everything a question about this context sends. */
export function CaptureDetails({
  context
}: {
  context: MauzDesktopContext | null;
}): React.JSX.Element | null {
  const details = describeCapture(context);

  if (details.length === 0) {
    return null;
  }

  return (
    <details className="capture-details">
      <summary>
        <Eye aria-hidden="true" size={13} />
        <span>What Mauz saw</span>
      </summary>
      <ul>
        {details.map((detail) => (
          <li key={detail.label}>
            <strong>{detail.label}</strong>
            {detail.text === undefined ? null : <p>{detail.text}</p>}
            {detail.image === undefined ? null : (
              <img
                src={`data:${detail.image.mimeType};base64,${detail.image.base64}`}
                alt="Image sent with the question"
              />
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
