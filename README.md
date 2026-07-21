# Minimal Reader

A quiet local-first reader for web and macOS.

## Features

- Left sidebar library with logical folders
- PDF, TXT, and DOCX reading
- Legacy `.doc` files can be imported and preserved, but should be converted to DOCX or PDF for readable preview
- Last-read page is saved per document
- Jump to a page from the floating bottom page control
- Zoom in, zoom out, and fit-to-screen PDF rendering
- No login or server account required
- Optional Google Drive sync, using the signed-in user's private App Data folder

## Enable Google Drive Sync

1. In Google Cloud Console, create a **Web application** OAuth client and add your Vercel URL to its authorized JavaScript origins.
2. Enable the Google Drive API for that project.
3. Add the client ID as `VITE_GOOGLE_CLIENT_ID` in Vercel's environment variables, then redeploy. Use [.env.example](.env.example) for local development.

Users choose their Google account only when they press **Sync Drive**. Documents are stored in that account's private Google Drive App Data folder, not in Vercel. Sync is manual and merges each document by its most recent update.

Google Drive sync currently runs in the web deployment. The packaged macOS app needs a separate desktop OAuth callback before it can use the same account.

## Run The Website Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Build The Website

```bash
npm run build
```

The static site is generated in `dist/`.

## Build The macOS App

```bash
npm run dist:mac
```

The installer artifacts are generated in `dist/`, including a `.dmg` and `.zip`.

Unsigned local builds may show a macOS security warning on first open unless you sign and notarize the app with an Apple Developer certificate.
