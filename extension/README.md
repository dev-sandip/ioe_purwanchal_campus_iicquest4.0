# Pragya Lekh

Pragya Lekh is a Plasmo browser extension for Nepali writing assistance. The
project is set up for Chrome MV3 and Firefox MV3 development.

## Getting Started

Install dependencies:

```bash
pnpm install
```

Start a Chrome development build:

```bash
pnpm dev
```

Load `build/chrome-mv3-dev` from `chrome://extensions` with developer mode
enabled.

Start a Firefox development build:

```bash
pnpm dev:firefox
```

Load `build/firefox-mv3-dev` from `about:debugging#/runtime/this-firefox`.

## Project Files

- `popup.tsx` is the extension popup.
- `options.tsx` is the extension settings page.
- `content.ts` is injected into HTTP and HTTPS pages.
- `lib/settings.ts` contains shared extension settings storage helpers.

## Checks

Run TypeScript and formatting checks before packaging:

```bash
pnpm typecheck
pnpm format:check
```

## Production Builds

Build Chrome:

```bash
pnpm build
```

Build Firefox:

```bash
pnpm build:firefox
```

Create a store package after building:

```bash
pnpm package
```
