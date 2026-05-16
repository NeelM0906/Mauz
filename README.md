<p align="center">
  <img src="apps/desktop/src/renderer/src/assets/mauzai-logo.png" alt="MauzAI" width="720" />
</p>

# Mauz

Mauz is a simple application that lets the user invoke an AI interaction through mouse gestures.

This is a research preview experimenting with ways to make AI feel more accessible, simple, and customizable on the desktop. The current experiment is intentionally small: gesture in, share the context you choose, interact with AI, and return to what you were doing.

Mauz is not a finished product. It is a working preview for trying out interaction patterns and for inviting others to build on the idea.

For local installation, credentials, macOS permissions, and packaging, see [setup.md](setup.md).

## What It Does

- Opens an AI interaction from a mouse gesture or shortcut.
- Lets the user choose when to share screen context.
- Supports text interaction with Mauz.
- Supports voice interaction with Mauz.
- Supports explicit screen sharing when live visual context matters.
- Keeps the interaction lightweight and close to the user's current task.

- Ask about the area around your cursor.
- Start a voice conversation with Mauz.
- Save and revisit previous text conversations.
- Tune mouse-shake activation so the assistant opens only when you mean it.
- Keep control of when screenshots and microphone audio are shared.

We hope people build integrations and customize Mauz to their own liking.

1. Summon Mauz near your cursor with the keyboard shortcut or mouse shake.
2. Choose Ask or Talk.
3. Mauz uses the context you approved to answer, explain, summarize, or guide your next step.
4. Close the popup when you are done and return to your work.

We will also work on supporting lightweight local models, so Mauz can experiment with simpler, lower-latency, and more private AI interactions where that makes sense.

## Current Preview

The current macOS preview includes:

- Mouse-gesture activation.
- Keyboard shortcut activation.
- User-approved screen context.
- Explicit screen sharing.
- Text interaction.
- Voice interaction.
- Local settings.
- Conversation history.

- Mouse shake only opens the menu.
- Ask mode captures context after you choose Ask Mauz.
- Voice starts only after you choose Talk to Mauz.
- Previous chats store the typed question, Mauz's text answer, generated title, and timestamps.
- Cursor crops, screenshots, selected text, and microphone audio are not used until the relevant action is started.

## Current Status

MauzAI is in macOS preview. The current product includes point-and-ask help, voice conversations, chat history, native mouse-shake activation, and local settings.
Text answers and Realtime voice use OpenAI credentials from `OPENAI_API_KEY` or a locally encrypted saved API key.

## Context Sharing

Mauz is built around user-controlled context sharing.

- Mouse gestures only open the interaction surface.
- Screen context is captured after the user chooses to share it.
- Voice starts only after the user chooses to start talking or share the screen.
- Screen sharing uses explicit screenshot frames while sharing is active.
- Previous chats store the typed question, Mauz's text answer, generated title, and timestamps.
- Cursor crops, screenshots, selected text, microphone audio, and screen frames are not used until the relevant action is started.

## Future Work

- Signed macOS builds.
- A smoother first-run onboarding flow.
- Richer conversation history controls.
- More precise context controls for shared windows and selected regions.
- Product polish for long-running voice sessions.

## License

MauzAI is available under the [FirstPoint Labs Research Preview License](LICENSE.md). It may be used, modified, and productionized with required attribution to FirstPoint Labs and relevant previous authors, and may never be used for privacy invasion or surveillance.
