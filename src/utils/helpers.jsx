import { DB_NAME, STORE_NAME, PAGE_CHARS, DELETED_DOCS_KEY } from "../constants/appConstants.jsx";
import mammoth from "mammoth/mammoth.browser";

export function storedDeletions() {
  try {
    return JSON.parse(localStorage.getItem(DELETED_DOCS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function mimeType(kind) {
  return { pdf: "application/pdf", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", epub: "application/epub+zip" }[kind] || "application/octet-stream";
}

export function applyEpubTheme(rendition, theme) {
  const dark = theme === "dark";
  rendition.themes.override("background-color", dark ? "#151014" : "#fff8f2", true);
  rendition.themes.override("color", dark ? "#fff8f2" : "#151014", true);
}

export function turnEpubPage(rendition, forward) {
  const location = rendition.location;
  const displayed = location?.start?.displayed;
  if (forward && displayed?.page >= displayed.total) {
    const next = rendition.book.spine.get(location.start.index)?.next();
    if (next) return rendition.display(next.href);
  }
  return forward ? rendition.next() : rendition.prev();
}

export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbAction(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = action(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

export async function listDocs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export function saveDoc(doc) {
  return dbAction("readwrite", (store) => store.put(doc));
}

export function removeDoc(id) {
  return dbAction("readwrite", (store) => store.delete(id));
}

export function clearDocs() {
  return dbAction("readwrite", (store) => store.clear());
}

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fileKind(file) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "text/plain" || name.endsWith(".txt")) return "txt";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  if (file.type === "application/epub+zip" || name.endsWith(".epub")) return "epub";
  return "unknown";
}

export function splitPages(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!normalized) return ["This document does not contain readable text."];
  const pages = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + PAGE_CHARS, normalized.length);
    if (end < normalized.length) {
      const breakAt = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf(" ", end)
      );
      if (breakAt > start + PAGE_CHARS * 0.65) end = breakAt + 1;
    }
    pages.push(normalized.slice(start, end).trim());
    start = end;
  }
  return pages;
}

export async function extractDocument(file, kind) {
  const buffer = await file.arrayBuffer();
  if (kind === "txt") {
    return { text: new TextDecoder().decode(buffer), buffer };
  }
  if (kind === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return { text: result.value, buffer };
  }
  if (kind === "doc") {
    return {
      text:
        "This legacy .doc file was imported and saved in your library. Minimal Reader can preserve it, but readable preview is available for PDF, TXT, and DOCX files. Export this document as DOCX or PDF to read it here.",
      buffer
    };
  }
  if (kind === "epub") {
    return { text: "", buffer };
  }
  return { text: "", buffer };
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
