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
- `content.ts` is the Plasmo content-script entrypoint.
- `features/content-script/` contains editable detection, prediction, popover,
  and insertion logic.
- `lib/settings.ts` contains shared extension settings storage helpers.

## Checks

Run TypeScript and formatting checks before packaging:

```bash
pnpm typecheck
pnpm format:check
```

## Website Login Flow

The popup Login button opens the website login page in a browser tab. Configure
the login URL with:

```bash
PLASMO_PUBLIC_AUTH_LOGIN_URL=https://yourdomain.com/login
```

The extension opens:

```text
https://yourdomain.com/login?source=extension
```

After login or signup, the TanStack app should create the session/JWT and
redirect to:

```text
chrome-extension://EXTENSION_ID/tabs/auth-callback.html?token=JWT
```

The callback page stores the JWT in `chrome.storage.local`. API calls can use
`authenticatedFetch` from `lib/auth.ts`; it sends:

```text
Authorization: Bearer TOKEN
```

For local development, set `DEV_AUTH_TOKEN` in `lib/auth.ts` to a JWT string.
When this variable is set, clicking Login stores that token directly instead of
opening the website login page.

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
