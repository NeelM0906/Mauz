<p align="center">
  <img src="apps/desktop/src/renderer/src/assets/mauzai-logo.png" alt="MauzAI" width="720" />
</p>

# Mauz

Mauz is a simple application that lets the user invoke an AI interaction through mouse gestures.

This is a research preview experimenting with ways to make AI feel more accessible, simple, and customizable on the desktop. The current experiment is intentionally small: gesture in, share the context you choose, interact with AI, and return to what you were doing.

Mauz is not a finished product. It is a working preview for trying out interaction patterns and for inviting others to build on the idea.

## What It Does

- Opens an AI interaction from a mouse gesture or shortcut.
- Lets the user choose when to share screen context.
- Supports text interaction with Mauz.
- Supports voice interaction with Mauz.
- Supports explicit screen sharing when live visual context matters.
- Keeps the interaction lightweight and close to the user's current task.

## Customization

We hope people build integrations and customize Mauz to their own liking.

One obvious improvement is web search. It would let Mauz answer with fresher context instead of only relying on the model and the user-provided screen context.

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

Text answers and Realtime voice use OpenAI API access through `OPENAI_API_KEY`. MauzAI does not store OpenAI keys in local settings.

## Context Sharing

Mauz is built around user-controlled context sharing.

- Mouse gestures only open the interaction surface.
- Screen context is captured after the user chooses to share it.
- Voice starts only after the user chooses to start talking or share the screen.
- Screen sharing uses explicit screenshot frames while sharing is active.
- Previous chats store the typed question, Mauz's text answer, generated title, and timestamps.
- Cursor crops, screenshots, selected text, microphone audio, and screen frames are not used until the relevant action is started.

## Future Work

- Web search integration.
- Support for lightweight local models.
- More ways to customize gestures and interaction flows.
- More integration points for people building on Mauz.
- Packaging, signing, and public distribution.

## License

MauzAI is available under the [FirstPoint Labs Research Preview License](LICENSE.md). It may be used, modified, and productionized with required attribution to FirstPoint Labs and relevant previous authors, and may never be used for privacy invasion or surveillance.
