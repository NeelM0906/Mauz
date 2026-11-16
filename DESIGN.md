# Mauz desktop design

Mauz is a short interaction at the pointer. The radial menu and compact popover should leave the work underneath easy to return to. The desktop renderer owns the visual system in `apps/desktop/src/renderer/src/styles.css`. Use its system font stack, light and dark surface and text tokens, Ask teal, and shared buttons, headers, focus styles, and reduced-motion rules.

Ask places its single question field and submit button directly below the header. The transcript scrolls below the composer and appears with the first turn. User questions use the Ask accent to make turns easy to scan. Answers keep the same Markdown formatting as the single-answer panel. Show staged screen evidence beside the composer so people can tell what they are asking about and remove it before sending. Reopening Ask shows the current transcript before a question can be submitted. Keep reading position when the user scrolls away from the newest answer.
