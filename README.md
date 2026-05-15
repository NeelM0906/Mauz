<p align="center">
  <img src="apps/desktop/src/renderer/src/assets/mauzai-logo.png" alt="MauzAI" width="720" />
</p>

# MauzAI

MauzAI is a macOS desktop assistant that appears where you are working. Shake your mouse or use the shortcut, choose what context to share, and ask about the screen in front of you without switching apps.

## Why MauzAI

Most assistants wait in a separate tab. MauzAI lives on the desktop, close to the thing you are looking at, so the conversation starts with the right visual context.

Use MauzAI when you want help understanding an interface, summarizing visible content, explaining an error, deciding what to do next, or talking through something on your screen.

## What You Can Do

- Ask about the area around your cursor.
- Start a voice conversation with Mauz.
- Share your screen explicitly when live visual context matters.
- Save and revisit previous text conversations.
- Tune mouse-shake activation so the assistant opens only when you mean it.
- Keep control of when screenshots, microphone audio, and screen frames are shared.

## How It Works

1. Summon Mauz near your cursor with the keyboard shortcut or mouse shake.
2. Choose Ask, Talk, or Show Mauz my screen.
3. Mauz uses the context you approved to answer, explain, summarize, or guide your next step.
4. Close the popup when you are done and return to your work.

## Product Principles

- Context should be intentional. Mauz does not capture your screen until you choose an action.
- Desktop help should be fast. The assistant opens near your cursor instead of pulling you into another app.
- Privacy controls should be visible. Screen sharing, microphone access, and history are all explicit user actions.
- Answers should be useful in place. Mauz is designed for short, practical help while you keep working.

## Privacy

MauzAI is built around user-controlled context sharing.

- Mouse shake only opens the menu.
- Ask mode captures context after you choose Ask Mauz.
- Voice starts only after you choose Talk to Mauz or Show Mauz my screen.
- Screen sharing uses explicit screenshot frames while sharing is active.
- Previous chats store the typed question, Mauz's text answer, generated title, and timestamps.
- Cursor crops, screenshots, selected text, and microphone audio are not used until the relevant action is started.

## Current Status

MauzAI is in macOS preview. The current product includes point-and-ask help, voice conversations, explicit screen sharing, chat history, native mouse-shake activation, and local settings.
Text answers can use either OpenAI API-key access or the local Codex CLI login. Realtime voice uses OpenAI API-key access.

Packaging, signing, and a public distribution flow are still upcoming.

## Roadmap

- Signed macOS builds.
- A smoother first-run onboarding flow.
- Richer conversation history controls.
- More precise context controls for shared windows and selected regions.
- Product polish for long-running voice and screen-sharing sessions.

## Brand

The MauzAI identity pairs a fast mouse mark with an electric bolt to match the product goal: quick desktop help the moment you need it.
