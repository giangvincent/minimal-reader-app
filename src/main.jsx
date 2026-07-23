import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import mammoth from "mammoth/mammoth.browser";
import ePub from "epubjs";
import { downloadDriveFile, googleDriveManifestName, listDriveFiles, loadGoogleIdentity, requestDriveToken, uploadDriveFile } from "./google-drive.js";

import ReaderViewManager from "./managers/ReaderViewManager.jsx";
import "./styles.css";
import * as svgIcons from "./svg-icons.jsx";
import { DB_NAME, STORE_NAME, PAGE_CHARS, FIT, manualZooms, GOOGLE_CLIENT_ID, DELETED_DOCS_KEY } from "./constants/appConstants.jsx";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function storedDeletions() {
  try {
    return JSON.parse(localStorage.getItem(DELETED_DOCS_KEY) || "{}");
  } catch {
    return {};
  }
}

function mimeType(kind) {
  return { pdf: "application/pdf", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", epub: "application/epub+zip" }[kind] || "application/octet-stream";
}

function applyEpubTheme(rendition, theme) {
  const dark = theme === "dark";
  rendition.themes.override("background-color", dark ? "#151014" : "#fff8f2", true);
  rendition.themes.override("color", dark ? "#fff8f2" : "#151014", true);
}

function turnEpubPage(rendition, forward) {
  const location = rendition.location;
  const displayed = location?.start?.displayed;
  if (forward && displayed?.page >= displayed.total) {
    const next = rendition.book.spine.get(location.start.index)?.next();
    if (next) return rendition.display(next.href);
  }
  return forward ? rendition.next() : rendition.prev();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAction(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = action(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function listDocs() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

function saveDoc(doc) {
  return dbAction("readwrite", (store) => store.put(doc));
}

function removeDoc(id) {
  return dbAction("readwrite", (store) => store.delete(id));
}

function clearDocs() {
  return dbAction("readwrite", (store) => store.clear());
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileKind(file) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "text/plain" || name.endsWith(".txt")) return "txt";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  if (file.type === "application/epub+zip" || name.endsWith(".epub")) return "epub";
  return "unknown";
}

function splitPages(text) {
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

async function extractDocument(file, kind) {
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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

function App() {
  const [docs, setDocs] = useState([]);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("minimal-reader-theme") || "light";
    } catch {
      return "light";
    }
  });
  const [customFolders, setCustomFolders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("minimal-reader-folders") || "[]");
    } catch {
      return [];
    }
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("minimal-reader-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [isReaderChromeHidden, setIsReaderChromeHidden] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [folder, setFolder] = useState("Library");
  const [pageInput, setPageInput] = useState("1");
  const [zoomMode, setZoomMode] = useState(FIT);
  const [manualZoom, setManualZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [pageRailHeight, setPageRailHeight] = useState(420);
  const [pdfState, setPdfState] = useState({ loading: false, pageCount: 0, error: "" });
  const [epubState, setEpubState] = useState({ loading: false, chapter: 0, chapterCount: 0, page: 0, pageCount: 0, error: "" });
  const [message, setMessage] = useState("");
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [extractedPage, setExtractedPage] = useState(null);
  const [isExtractingPage, setIsExtractingPage] = useState(false);
  const [deletedDocs, setDeletedDocs] = useState(storedDeletions);
  const [isSyncing, setIsSyncing] = useState(false);
  const canvasRef = useRef(null);
  const epubRef = useRef(null);
  const epubRenditionRef = useRef(null);
  const stageRef = useRef(null);
  const textPageRef = useRef(null);
  const swipeStartRef = useRef(null);

  const folders = useMemo(() => {
    const unique = new Set(["Library", ...customFolders, ...docs.map((doc) => doc.folder || "Library")]);
    return [...unique].sort((a, b) => (a === "Library" ? -1 : a.localeCompare(b)));
  }, [customFolders, docs]);

  const visibleDocs = docs.filter((doc) => (doc.folder || "Library") === folder);
  const selectedDoc = docs.find((doc) => doc.id === activeId);
  const activeDoc = selectedDoc && (selectedDoc.folder || "Library") === folder ? selectedDoc : visibleDocs[0] || null;

  const textPages = useMemo(() => {
    if (!activeDoc || activeDoc.kind === "pdf" || activeDoc.kind === "epub") return [];
    return splitPages(activeDoc.text || "");
  }, [activeDoc]);

  const totalPages = activeDoc?.kind === "pdf"
    ? pdfState.pageCount || activeDoc.pageCount || 1
    : activeDoc?.kind === "epub"
      ? epubState.pageCount || activeDoc.pageCount || 1
      : textPages.length || 1;
  const currentPage = Math.min(Math.max(activeDoc?.kind === "epub" ? epubState.page || activeDoc.page || 1 : activeDoc?.page || 1, 1), totalPages);
  const zoom = zoomMode === FIT ? fitZoom : manualZoom;

  const goToPage = useCallback(async (page) => {
    if (!activeDoc) return;
    const forward = page > currentPage;
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    if (activeDoc.kind === "epub") {
      const rendition = epubRenditionRef.current;
      if (rendition) await turnEpubPage(rendition, forward);
      return;
    }
    if (stageRef.current) stageRef.current.scrollTop = 0;
    await persistDoc({ ...activeDoc, page: nextPage });
  }, [activeDoc, currentPage, totalPages]);

  const handleSwipeStart = useCallback((event) => {
    if (window.innerWidth > 524 || event.target.closest("button, input, select, label")) return;
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleSwipeEnd = useCallback((event) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || !activeDoc) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    goToPage(currentPage + (deltaX < 0 ? 1 : -1));
  }, [activeDoc, currentPage, goToPage]);

  useEffect(() => {
    listDocs().then((items) => {
      setDocs(items);
      setActiveId(items[0]?.id || null);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("minimal-reader-folders", JSON.stringify(customFolders));
  }, [customFolders]);

  useEffect(() => {
    localStorage.setItem(DELETED_DOCS_KEY, JSON.stringify(deletedDocs));
  }, [deletedDocs]);

  useEffect(() => {
    localStorage.setItem("minimal-reader-sidebar", isSidebarCollapsed ? "collapsed" : "expanded");
  }, [isSidebarCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("minimal-reader-theme", theme);
    if (epubRenditionRef.current) applyEpubTheme(epubRenditionRef.current, theme);
  }, [theme]);

  useEffect(() => {
    if (activeDoc && activeDoc.id !== activeId) setActiveId(activeDoc.id);
  }, [activeDoc, activeId]);

  useLayoutEffect(() => {
    if (zoomMode !== FIT || !activeDoc || activeDoc.kind === "pdf" || activeDoc.kind === "epub") return;

    function measureFitZoom() {
      const stage = stageRef.current;
      const page = textPageRef.current;
      if (!stage || !page) return;

      const availableWidth = Math.max(stage.clientWidth - 176, 320);
      const baseWidth = page.offsetWidth || 780;
      setFitZoom(Math.min(Math.max(availableWidth / baseWidth, 0.7), 2.25));
    }

    measureFitZoom();
    const observer = new ResizeObserver(measureFitZoom);
    observer.observe(stageRef.current);
    observer.observe(textPageRef.current);
    return () => observer.disconnect();
  }, [activeDoc?.id, zoomMode, textPages.length]);

  useLayoutEffect(() => {
    if (!activeDoc) return;

    function measurePageHeight() {
      const stage = stageRef.current;
      const page = activeDoc.kind === "pdf" ? canvasRef.current : activeDoc.kind === "epub" ? epubRef.current : textPageRef.current;
      if (!stage || !page) return;

      const pageHeight = page.getBoundingClientRect().height;
      const maxHeight = Math.max(stage.clientHeight - 114, 220);
      setPageRailHeight(Math.round(Math.min(Math.max(pageHeight, 220), maxHeight)));
    }

    measurePageHeight();
    const observer = new ResizeObserver(measurePageHeight);
    if (stageRef.current) observer.observe(stageRef.current);
    if (textPageRef.current) observer.observe(textPageRef.current);
    if (canvasRef.current) observer.observe(canvasRef.current);
    if (epubRef.current) observer.observe(epubRef.current);
    return () => observer.disconnect();
  }, [activeDoc?.id, activeDoc?.kind, currentPage, pdfState.loading, zoom]);

  useEffect(() => {
    function handleKeyboardNavigation(event) {
      if (!activeDoc || isFolderDialogOpen || extractedPage) return;

      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (isTyping) return;

      const nextKeys = new Set(["ArrowRight", "PageDown", " "]);
      const previousKeys = new Set(["ArrowLeft", "PageUp"]);

      if (nextKeys.has(event.key)) {
        event.preventDefault();
        goToPage(currentPage + 1);
      }

      if (previousKeys.has(event.key)) {
        event.preventDefault();
        goToPage(currentPage - 1);
      }
    }

    window.addEventListener("keydown", handleKeyboardNavigation);
    return () => window.removeEventListener("keydown", handleKeyboardNavigation);
  }, [activeDoc, currentPage, extractedPage, goToPage, isFolderDialogOpen]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage, activeId]);

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "pdf") return;
    let cancelled = false;
    let loadingTask;

    async function renderPdf() {
      setPdfState((state) => ({ ...state, loading: true, error: "" }));
      try {
        loadingTask = pdfjsLib.getDocument({ data: activeDoc.buffer.slice(0) });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(currentPage);
        const baseViewport = page.getViewport({ scale: 1 });
        const stage = stageRef.current;
        const railWidth = window.innerWidth <= 600 ? 0 : 176;
        const availableWidth = Math.max((stage?.clientWidth || 900) - railWidth, 1);
        const fitScale = availableWidth / baseViewport.width;
        const scale = zoomMode === FIT ? fitScale : manualZoom;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) {
          setPdfState({ loading: false, pageCount: pdf.numPages, error: "" });
          if (activeDoc.pageCount !== pdf.numPages) {
            persistDoc({ ...activeDoc, pageCount: pdf.numPages }, false);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setPdfState({ loading: false, pageCount: activeDoc.pageCount || 0, error: "Unable to render this PDF." });
        }
      }
    }

    renderPdf();
    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
    };
  }, [activeDoc?.id, currentPage, manualZoom, zoomMode]);

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "epub" || !epubRef.current) return;
    let cancelled = false;
    const book = ePub(activeDoc.buffer.slice(0));
    book.spine.hooks.content.register((document) => {
      [...document.getElementsByTagName("*")].forEach((element) => {
        if (element.localName?.toLowerCase() === "script") element.remove();
      });
    });
    const rendition = book.renderTo(epubRef.current, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      spread: "none",
      manager: ReaderViewManager
    });
    epubRenditionRef.current = rendition;
    applyEpubTheme(rendition, theme);
    setEpubState({ loading: true, chapter: 0, chapterCount: 0, page: 0, pageCount: activeDoc.pageCount || 0, error: "" });

    let touchStart;
    const onTouchStart = (event) => {
      const touch = event.touches[0];
      touchStart = touch && { x: touch.clientX, y: touch.clientY };
    };
    const onTouchEnd = (event) => {
      const touch = event.changedTouches[0];
      if (!touchStart || !touch) return;
      const { x, y } = touchStart;
      touchStart = null;
      if (Math.abs(touch.clientX - x) < 64 || Math.abs(touch.clientX - x) <= Math.abs(touch.clientY - y)) return;
      turnEpubPage(rendition, touch.clientX < x);
    };
    rendition.hooks.content.register((contents) => {
      contents.document.addEventListener("touchstart", onTouchStart, { passive: true });
      contents.document.addEventListener("touchend", onTouchEnd, { passive: true });
    });

    rendition.on("relocated", (location) => {
      if (cancelled) return;
      const page = location.start.displayed.page || 1;
      const pageCount = location.start.displayed.total || 1;
      const chapter = (location.start.index || 0) + 1;
      const chapterCount = book.spine.length || 1;
      setEpubState({ loading: false, chapter, chapterCount, page, pageCount, error: "" });
      if (activeDoc.page !== page || activeDoc.pageCount !== pageCount || activeDoc.epubCfi !== location.start.cfi) {
        persistDoc({ ...activeDoc, page, pageCount, epubCfi: location.start.cfi });
      }
    });

    Promise.resolve()
      .then(() => book.ready)
      .then(() => rendition.display(activeDoc.epubCfi))
      .catch(() => !cancelled && setEpubState({ loading: false, pageCount: 0, error: "Unable to render this EPUB." }));

    return () => {
      cancelled = true;
      epubRenditionRef.current = null;
      rendition.destroy();
      book.destroy();
    };
  }, [activeDoc?.id]);

  async function refreshDocs(nextActiveId) {
    const items = await listDocs();
    setDocs(items);
    if (nextActiveId) setActiveId(nextActiveId);
  }

  async function persistDoc(nextDoc, touch = true) {
    const updated = { ...nextDoc, updatedAt: touch ? Date.now() : nextDoc.updatedAt };
    setDocs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    await saveDoc(updated);
  }

  async function syncWithGoogle() {
    if (!/^https?:$/.test(location.protocol)) {
      setMessage("Google Drive sync is available from the Vercel web app. Packaged macOS OAuth is not configured yet.");
      return;
    }
    if (!GOOGLE_CLIENT_ID) {
      setMessage("Add VITE_GOOGLE_CLIENT_ID in Vercel to enable Google Drive sync.");
      return;
    }

    setIsSyncing(true);
    try {
      await loadGoogleIdentity();
      const token = await requestDriveToken(GOOGLE_CLIENT_ID);
      const files = await listDriveFiles(token);
      const manifestFiles = files.filter((file) => file.name === googleDriveManifestName);
      const manifests = await Promise.all(manifestFiles.map(async (file) => JSON.parse(new TextDecoder().decode(await downloadDriveFile(token, file.id)))));
      const remote = manifests.reduce((library, next) => {
        const documents = new Map(library.docs.map((doc) => [doc.id, doc]));
        for (const doc of next.docs || []) {
          if (!documents.has(doc.id) || doc.updatedAt >= documents.get(doc.id).updatedAt) documents.set(doc.id, doc);
        }
        const deletedDocs = { ...library.deletedDocs, ...next.deletedDocs };
        for (const [id, time] of Object.entries(next.deletedDocs || {})) deletedDocs[id] = Math.max(time, library.deletedDocs[id] || 0);
        return { docs: [...documents.values()], folders: [...new Set([...library.folders, ...(next.folders || [])])], deletedDocs };
      }, { docs: [], folders: [], deletedDocs: {} });
      const manifestFile = manifestFiles[0];
      if (!manifestFile && !docs.length) {
        setMessage("No Drive library found yet. Sync the device that has your files first.");
        return;
      }
      const mergedDeletions = { ...remote.deletedDocs, ...deletedDocs };
      for (const [id, time] of Object.entries(remote.deletedDocs || {})) {
        mergedDeletions[id] = Math.max(time, deletedDocs[id] || 0);
      }

      const remoteDocs = new Map((remote.docs || []).map((doc) => [doc.id, doc]));
      const localDocs = new Map(docs.map((doc) => [doc.id, doc]));
      const mergedDocs = [];
      for (const id of new Set([...remoteDocs.keys(), ...localDocs.keys()])) {
        const local = localDocs.get(id);
        const remoteDoc = remoteDocs.get(id);
        const newest = !remoteDoc || (local && local.updatedAt >= remoteDoc.updatedAt) ? local : remoteDoc;
        if (newest && (mergedDeletions[id] || 0) < newest.updatedAt) {
          mergedDocs.push({ ...remoteDoc, ...local, ...newest, remoteFileId: newest.remoteFileId || remoteDoc?.remoteFileId || local?.remoteFileId });
        }
      }

      for (const doc of mergedDocs) {
        const remoteDoc = remoteDocs.get(doc.id);
        const local = localDocs.get(doc.id);
        if (local && (!remoteDoc || local.updatedAt > remoteDoc.updatedAt || !remoteDoc.remoteFileId)) {
          doc.remoteFileId = await uploadDriveFile(token, {
            id: doc.remoteFileId,
            name: `minimal-reader-${doc.id}`,
            data: local.buffer,
            type: mimeType(doc.kind)
          });
          doc.buffer = local.buffer;
        } else if (doc.remoteFileId) {
          doc.buffer = await downloadDriveFile(token, doc.remoteFileId);
        }
      }

      const nextFolders = [...new Set([...(remote.folders || []), ...customFolders])];
      const manifest = {
        docs: mergedDocs.map(({ buffer, ...doc }) => doc),
        folders: nextFolders,
        deletedDocs: mergedDeletions
      };
      await uploadDriveFile(token, {
        id: manifestFile?.id,
        name: googleDriveManifestName,
        data: JSON.stringify(manifest),
        type: "application/json"
      });

      await clearDocs();
      for (const doc of mergedDocs) await saveDoc(doc);
      setDocs(mergedDocs.sort((a, b) => b.updatedAt - a.updatedAt));
      setActiveId((id) => mergedDocs.some((doc) => doc.id === id) ? id : mergedDocs[0]?.id || null);
      setCustomFolders(nextFolders);
      setDeletedDocs(mergedDeletions);
      setMessage(`Google Drive sync complete: ${mergedDocs.length} file${mergedDocs.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error.message || "Google Drive sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleImport(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;

    let lastImportedId = null;
    let importedCount = 0;
    for (const file of files) {
      const kind = fileKind(file);
      if (kind === "unknown") {
        setMessage(`${file.name} is not a supported file type.`);
        continue;
      }
      let extracted;
      try {
        extracted = await extractDocument(file, kind);
      } catch {
        setMessage(`Unable to read ${file.name}.`);
        continue;
      }
      const doc = {
        id: uid(),
        name: file.name,
        kind,
        folder,
        page: 1,
        pageCount: kind === "pdf" || kind === "epub" ? 0 : splitPages(extracted.text).length,
        text: extracted.text,
        buffer: extracted.buffer,
        size: file.size,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveDoc(doc);
      lastImportedId = doc.id;
      importedCount += 1;
    }
    await refreshDocs(lastImportedId);
    setMessage(`${importedCount} file${importedCount === 1 ? "" : "s"} imported.`);
  }

  function createFolder() {
    setFolderName("");
    setIsFolderDialogOpen(true);
  }

  function confirmCreateFolder(event) {
    event.preventDefault();
    const clean = folderName.trim();
    if (!clean) return;
    setCustomFolders((items) => (items.includes(clean) ? items : [...items, clean]));
    setFolder(clean);
    setActiveId(null);
    setIsFolderDialogOpen(false);
    setMessage(`Folder "${clean}" created.`);
  }

  async function moveActiveDoc(nextFolder) {
    if (!activeDoc) return;
    await persistDoc({ ...activeDoc, folder: nextFolder });
    setFolder(nextFolder);
  }

  function changeZoom(direction) {
    if (zoomMode === FIT) {
      setZoomMode("manual");
      setManualZoom(direction > 0 ? 1.15 : 0.85);
      return;
    }
    const index = manualZooms.reduce((best, value, idx) => {
      return Math.abs(value - manualZoom) < Math.abs(manualZooms[best] - manualZoom) ? idx : best;
    }, 0);
    const nextIndex = Math.min(Math.max(index + direction, 0), manualZooms.length - 1);
    setManualZoom(manualZooms[nextIndex]);
  }

  async function deleteActiveDoc() {
    if (!activeDoc) return;
    await removeDoc(activeDoc.id);
    setDeletedDocs((items) => ({ ...items, [activeDoc.id]: Date.now() }));
    const remaining = docs.filter((doc) => doc.id !== activeDoc.id);
    setDocs(remaining);
    setActiveId(remaining[0]?.id || null);
  }

  async function deleteLibrary() {
    if (!docs.length) return;
    const confirmed = window.confirm("Delete every document in your library? This cannot be undone.");
    if (!confirmed) return;
    await clearDocs();
    setDeletedDocs((items) => ({ ...items, ...Object.fromEntries(docs.map((doc) => [doc.id, Date.now()])) }));
    setDocs([]);
    setActiveId(null);
    setMessage("Library deleted.");
  }

  async function extractCurrentPageText() {
    if (!activeDoc || isExtractingPage) return;
    setIsExtractingPage(true);
    try {
      let text = "";
      if (activeDoc.kind === "pdf") {
        const loadingTask = pdfjsLib.getDocument({ data: activeDoc.buffer.slice(0) });
        try {
          const pdf = await loadingTask.promise;
          const page = await pdf.getPage(currentPage);
          const content = await page.getTextContent();
          text = content.items
            .map((item) => item.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        } finally {
          loadingTask.destroy?.();
        }
      } else if (activeDoc.kind === "epub") {
        text = epubRef.current?.querySelector("iframe")?.contentDocument?.body?.innerText || "";
      } else {
        text = textPages[currentPage - 1] || "";
      }

      setExtractedPage({
        page: currentPage,
        text: text || "No readable text was found on this page."
      });
    } catch {
      setMessage("Unable to extract text from this page.");
    } finally {
      setIsExtractingPage(false);
    }
  }

  return (
    <main className={isSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-copy">
            <h1>Minimal Reader</h1>
            <p>{docs.length} document{docs.length === 1 ? "" : "s"}</p>
          </div>
          <button
            className="icon-button sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((value) => !value)}
            title={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <svgIcons.ChevronLeftIcon />
          </button>
          <button className="icon-button create-folder-button" onClick={createFolder} title="Create folder">
            <svgIcons.PlusIcon />
          </button>
        </div>

        <label className="sidebar-button import-button">
          <input accept=".pdf,.txt,.doc,.docx,.epub,application/pdf,application/epub+zip,text/plain" multiple onChange={handleImport} type="file" />
          Import
        </label>

        <button className="sidebar-button sync-button" onClick={syncWithGoogle} disabled={isSyncing}>
          {isSyncing ? "Syncing..." : "Sync Drive"}
        </button>

        <button className="sidebar-button delete-library-button" onClick={deleteLibrary} disabled={!docs.length}>
          Delete library
        </button>

        <nav className="folders" aria-label="Folders">
          {folders.map((item) => (
            <button className={item === folder ? "active" : ""} key={item} onClick={() => setFolder(item)}>
              <span>{item}</span>
              <small>{docs.filter((doc) => (doc.folder || "Library") === item).length}</small>
            </button>
          ))}
        </nav>

        <div className="document-list">
          {visibleDocs.map((doc) => (
            <button className={doc.id === activeDoc?.id ? "doc active" : "doc"} key={doc.id} onClick={() => {setActiveId(doc.id); setIsSidebarCollapsed(true);}}>
              <strong>{doc.name}</strong>
              <span>{doc.kind.toUpperCase()} · p. {doc.page || 1} · {formatDate(doc.updatedAt)}</span>
            </button>
          ))}
          {!visibleDocs.length && <p className="empty">Import files or create a folder to begin.</p>}
        </div>

        <button
          className="icon-button reader-chrome-toggle"
          onClick={() => setIsReaderChromeHidden((value) => !value)}
          title={isReaderChromeHidden ? "Show reader controls" : "Hide reader controls"}
          aria-label={isReaderChromeHidden ? "Show reader controls" : "Hide reader controls"}
          aria-pressed={isReaderChromeHidden}
        >
          UI
        </button>
      </aside>

      <section className="reader">
        <header className={isReaderChromeHidden ? "toolbar reader-chrome-hidden" : "toolbar"}>
          <div className="title-block">
            <button
              className="icon-button toolbar-sidebar-toggle"
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              title={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              <svgIcons.ChevronLeftIcon />
            </button>
            <span>{activeDoc?.folder || "Library"}</span>
            <h2>{activeDoc?.name || "No document selected"}</h2>
          </div>
          <div className="toolbar-actions">
            {activeDoc && (
              <select value={activeDoc.folder || "Library"} onChange={(event) => moveActiveDoc(event.target.value)} title="Move to folder">
                {folders.map((item) => <option key={item}>{item}</option>)}
              </select>
            )}
            <button onClick={() => setZoomMode(FIT)} className={zoomMode === FIT ? "selected" : ""}>Fit</button>
            <button onClick={() => changeZoom(-1)} title="Zoom out" style={{ fontSize: "24px" }}>-</button>
            <button onClick={() => changeZoom(1)} title="Zoom in" style={{ fontSize: "24px" }}>+</button>
            <button onClick={deleteActiveDoc} disabled={!activeDoc}>Delete</button>
          </div>
        </header>

        <div className="doc-nav">
          {activeDoc && (
            <>
              <button
                className="side-page-button side-page-button-left"
                onClick={() => goToPage(currentPage - 1)}
                disabled={activeDoc?.kind !== "epub" && currentPage <= 1}
                title="Previous page (ArrowLeft or PageUp)"
              >
                <svgIcons.ChevronLeftIcon />
              </button>
              <button
                className="side-page-button side-page-button-right"
                onClick={() => goToPage(currentPage + 1)}
                disabled={activeDoc?.kind !== "epub" && currentPage >= totalPages}
                title="Next page (ArrowRight, Space, or PageDown)"
              >
                <svgIcons.ChevronRightIcon />
              </button>
            </>
          )}
        </div>

        <div
          className={zoomMode === FIT ? "stage" : "stage manual-zoom"}
          ref={stageRef}
          style={{ "--page-rail-height": `${pageRailHeight}px` }}
          onTouchStart={handleSwipeStart}
          onTouchEnd={handleSwipeEnd}
        >
          {!activeDoc && (
            <div className="welcome">
              <h3>{docs.length ? "This folder is empty" : "Import a PDF, DOCX, DOC, or TXT file"}</h3>
              <p>{docs.length ? "Import a file here or move a document into this folder." : "Your library stays local in this browser or desktop app. No login is required."}</p>
            </div>
          )}

          {activeDoc?.kind === "pdf" && (
            <div className="pdf-page">
              {pdfState.loading && <span className="loading">Loading page...</span>}
              {pdfState.error && <span className="loading">{pdfState.error}</span>}
              <canvas ref={canvasRef} />
            </div>
          )}

          {activeDoc?.kind === "epub" && (
            <div className="epub-page">
              {epubState.loading && <span className="loading">Loading book...</span>}
              {epubState.error && <span className="loading">{epubState.error}</span>}
              <div ref={epubRef} />
            </div>
          )}

          {activeDoc && activeDoc.kind !== "pdf" && activeDoc.kind !== "epub" && (
            <article className="text-page" ref={textPageRef} style={{ transform: `scale(${zoom})` }}>
              <pre>{textPages[currentPage - 1]}</pre>
            </article>
          )}
        </div>

        {activeDoc && (
          <footer className={isReaderChromeHidden ? "page-float reader-chrome-hidden" : "page-float"}>
            <button onClick={() => goToPage(currentPage - 1)} disabled={activeDoc.kind !== "epub" && currentPage <= 1}>Prev</button>
            <button onClick={extractCurrentPageText} disabled={isExtractingPage}>
              {isExtractingPage ? "Extracting..." : "Extract text"}
            </button>
            {activeDoc.kind === "epub" ? (
              <span className="epub-location">Chapter {epubState.chapter || 1} / {epubState.chapterCount || 1} · Page {currentPage} / {totalPages}</span>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  goToPage(Number(pageInput));
                }}
              >
                <input inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} />
                <span>/ {totalPages}</span>
              </form>
            )}
            <button onClick={() => goToPage(currentPage + 1)} disabled={activeDoc.kind !== "epub" && currentPage >= totalPages}>Next</button>
          </footer>
        )}

        <button
          className="theme-toggle"
          onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span aria-hidden="true">{theme === "dark" ? <svgIcons.SunIcon /> : <svgIcons.MoonIcon />}</span>
        </button>

        {message && <div className="toast" onAnimationEnd={() => setMessage("")}>{message}</div>}

        {extractedPage && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={() => setExtractedPage(null)}>
            <section
              className="text-extract-dialog"
              aria-labelledby="text-extract-title"
              role="dialog"
              aria-modal="true"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="text-extract-header">
                <h3 id="text-extract-title">Page {extractedPage.page} text</h3>
                <button className="icon-button" onClick={() => setExtractedPage(null)} title="Close">
                  <svgIcons.CloseIcon />
                </button>
              </div>
              <pre>{extractedPage.text}</pre>
            </section>
          </div>
        )}

        {isFolderDialogOpen && (
          <div className="dialog-backdrop" role="presentation" onMouseDown={() => setIsFolderDialogOpen(false)}>
            <form className="folder-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={confirmCreateFolder}>
              <h3>Create folder</h3>
              <input
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="Folder name"
              />
              <div className="dialog-actions">
                <button type="button" onClick={() => setIsFolderDialogOpen(false)}>Cancel</button>
                <button type="submit">Create</button>
              </div>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
