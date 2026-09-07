# LENS

LENS is a research workspace for turning a question into a clearer, source-backed understanding. The user selected the English name and a neutral visual language inspired by Vercel and Cursor, while retaining the application's familiar layout.

## Name and voice

Write **LENS** in both English and Arabic interfaces. Do not transliterate the wordmark or add an unimplemented Pro tier. The short brand line is **Research, in focus.** The Arabic expression is **نظرة أعمق. فهم أوضح.**

Speak clearly, precisely, and without superlatives. State what a control does and explain how to recover when a task fails. Avoid guaranteed accuracy, invented source counts, unverified security promises, and technical model names in the main research call to action.

## Mark

The mark consists of two concentric circles and four focus ticks. It represents framing a question and examining it more closely. Keep the mark monochrome and upright. Minimum mark size: 24px; preferred navigation size: 31px. Keep at least one quarter of the mark's width clear around it.

The wordmark uses Inter at weight 600 with moderate spacing. It remains left-to-right within Arabic layouts. The main component is `frontend/src/components/brand/BrandLogo.tsx`. Web and desktop assets are `frontend/public/lens.svg`, `frontend/public/lens.png`, and `frontend/build/lens.ico`.

## Color and composition

Dark canvas #111111, rail #0D0D0D, panels #191919, dividers #303030, primary ink #EDEDEB. Light canvas #FAFAF9, panels #FFFFFF, primary ink #191918. Primary actions invert the foreground and background. Color is reserved for meaningful research or connection states.

Retain the navigation rail and central research/report area. Use a slim workspace header, a clearly framed question composer, concise controls, and understated topic rows. Reuse the same control shapes in research, library, discovery, and settings. Avoid decorative gradients, glow, and oversized marketing elements.

## Product continuity

The app title, setup product name, shortcut name, settings identity, and icons use LENS. Package identity, appId, existing history/settings storage keys, and research endpoints remain stable to preserve compatibility. The name is a creative selection; trademark and domain availability have not been assessed.

The implemented token and component specification lives in DESIGN.md. Screenshots and the verification record live under `.impeccable/review/`.
