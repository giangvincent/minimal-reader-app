import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import mammoth from "mammoth/mammoth.browser";
import "./styles.css";
import * as svgIcons from "./svg-icons.jsx";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const DB_NAME = "minimal-reader-db";
const STORE_NAME = "documents";
const PAGE_CHARS = 2600;
const FIT = "fit";
const manualZooms = [0.7, 0.85, 1, 1.15, 1.35, 1.6, 1.9, 2.25];

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
  const [activeId, setActiveId] = useState(null);
  const [folder, setFolder] = useState("Library");
  const [pageInput, setPageInput] = useState("1");
  const [zoomMode, setZoomMode] = useState(FIT);
  const [manualZoom, setManualZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [pageRailHeight, setPageRailHeight] = useState(420);
  const [pdfState, setPdfState] = useState({ loading: false, pageCount: 0, error: "" });
  const [message, setMessage] = useState("");
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [extractedPage, setExtractedPage] = useState(null);
  const [isExtractingPage, setIsExtractingPage] = useState(false);
  const canvasRef = useRef(null);
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
    if (!activeDoc || activeDoc.kind === "pdf") return [];
    return splitPages(activeDoc.text || "");
  }, [activeDoc]);

  const totalPages = activeDoc?.kind === "pdf" ? pdfState.pageCount || activeDoc.pageCount || 1 : textPages.length || 1;
  const currentPage = Math.min(Math.max(activeDoc?.page || 1, 1), totalPages);
  const zoom = zoomMode === FIT ? fitZoom : manualZoom;

  const goToPage = useCallback(async (page) => {
    if (!activeDoc) return;
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    if (stageRef.current) stageRef.current.scrollTop = 0;
    await persistDoc({ ...activeDoc, page: nextPage });
  }, [activeDoc, totalPages]);

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
    localStorage.setItem("minimal-reader-sidebar", isSidebarCollapsed ? "collapsed" : "expanded");
  }, [isSidebarCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("minimal-reader-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (activeDoc && activeDoc.id !== activeId) setActiveId(activeDoc.id);
  }, [activeDoc, activeId]);

  useLayoutEffect(() => {
    if (zoomMode !== FIT || !activeDoc || activeDoc.kind === "pdf") return;

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
      const page = activeDoc.kind === "pdf" ? canvasRef.current : textPageRef.current;
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

  async function handleImport(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;

    let lastImportedId = null;
    for (const file of files) {
      const kind = fileKind(file);
      if (kind === "unknown") {
        setMessage(`${file.name} is not a supported file type.`);
        continue;
      }
      const extracted = await extractDocument(file, kind);
      const doc = {
        id: uid(),
        name: file.name,
        kind,
        folder,
        page: 1,
        pageCount: kind === "pdf" ? 0 : splitPages(extracted.text).length,
        text: extracted.text,
        buffer: extracted.buffer,
        size: file.size,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveDoc(doc);
      lastImportedId = doc.id;
    }
    await refreshDocs(lastImportedId);
    setMessage(`${files.length} file${files.length === 1 ? "" : "s"} imported.`);
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
    const remaining = docs.filter((doc) => doc.id !== activeDoc.id);
    setDocs(remaining);
    setActiveId(remaining[0]?.id || null);
  }

  async function deleteLibrary() {
    if (!docs.length) return;
    const confirmed = window.confirm("Delete every document in your library? This cannot be undone.");
    if (!confirmed) return;
    await clearDocs();
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

        <label className="import-button">
          <input accept=".pdf,.txt,.doc,.docx,application/pdf,text/plain" multiple onChange={handleImport} type="file" />
          Import
        </label>

        <button className="delete-library-button" onClick={deleteLibrary} disabled={!docs.length}>
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
            <button className={doc.id === activeDoc?.id ? "doc active" : "doc"} key={doc.id} onClick={() => setActiveId(doc.id)}>
              <strong>{doc.name}</strong>
              <span>{doc.kind.toUpperCase()} · p. {doc.page || 1} · {formatDate(doc.updatedAt)}</span>
            </button>
          ))}
          {!visibleDocs.length && <p className="empty">Import files or create a folder to begin.</p>}
        </div>
      </aside>

      <section className="reader">
        <header className="toolbar">
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
                disabled={currentPage <= 1}
                title="Previous page (ArrowLeft or PageUp)"
              >
                <svgIcons.ChevronLeftIcon />
              </button>
              <button
                className="side-page-button side-page-button-right"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                title="Next page (ArrowRight, Space, or PageDown)"
              >
                <svgIcons.ChevronRightIcon />
              </button>
            </>
          )}
        </div>

        <div
          className="stage"
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

          {activeDoc && activeDoc.kind !== "pdf" && (
            <article className="text-page" ref={textPageRef} style={{ transform: `scale(${zoom})` }}>
              <pre>{textPages[currentPage - 1]}</pre>
            </article>
          )}
        </div>

        {activeDoc && (
          <footer className="page-float">
            <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>Prev</button>
            <button onClick={extractCurrentPageText} disabled={isExtractingPage}>
              {isExtractingPage ? "Extracting..." : "Extract text"}
            </button>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                goToPage(Number(pageInput));
              }}
            >
              <input inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} />
              <span>/ {totalPages}</span>
            </form>
            <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>Next</button>
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
