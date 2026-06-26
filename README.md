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
