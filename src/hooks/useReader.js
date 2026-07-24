import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import ePub from "epubjs";
import ReaderViewManager from "../managers/ReaderViewManager.jsx";
import { FIT, manualZooms, GOOGLE_CLIENT_ID, DELETED_DOCS_KEY } from "../constants/appConstants.jsx";
import {
  uid, splitPages, extractDocument, applyEpubTheme, turnEpubPage,
  saveDoc, removeDoc, clearDocs, listDocs, mimeType, fileKind, formatDate
} from "../utils/helpers.jsx";
import { downloadDriveFile, googleDriveManifestName, listDriveFiles, loadGoogleIdentity, requestDriveToken, uploadDriveFile } from "../google-drive.js";

export default function useReader() {
  const [docs, setDocs] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem("minimal-reader-theme") || "light");
  const [customFolders, setCustomFolders] = useState(() => JSON.parse(localStorage.getItem("minimal-reader-folders") || "[]"));
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem("minimal-reader-sidebar") === "collapsed");
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
  const [deletedDocs, setDeletedDocs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DELETED_DOCS_KEY) || "{}"); } catch { return {}; }
  });
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

  useEffect(() => { localStorage.setItem("minimal-reader-folders", JSON.stringify(customFolders)); }, [customFolders]);
  useEffect(() => { localStorage.setItem(DELETED_DOCS_KEY, JSON.stringify(deletedDocs)); }, [deletedDocs]);
  useEffect(() => { localStorage.setItem("minimal-reader-sidebar", isSidebarCollapsed ? "collapsed" : "expanded"); }, [isSidebarCollapsed]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("minimal-reader-theme", theme);
    if (epubRenditionRef.current) applyEpubTheme(epubRenditionRef.current, theme);
  }, [theme]);
  useEffect(() => { if (activeDoc && activeDoc.id !== activeId) setActiveId(activeDoc.id); }, [activeDoc, activeId]);

  useLayoutEffect(() => {
    if (zoomMode !== FIT || !activeDoc || activeDoc.kind === "pdf" || activeDoc.kind === "epub") return;
    function measureFitZoom() {
      const stage = stageRef.current; const page = textPageRef.current;
      if (!stage || !page) return;
      const availableWidth = Math.max(stage.clientWidth - 176, 320);
      const baseWidth = page.offsetWidth || 780;
      setFitZoom(Math.min(Math.max(availableWidth / baseWidth, 0.7), 2.25));
    }
    measureFitZoom();
    const observer = new ResizeObserver(measureFitZoom);
    observer.observe(stageRef.current); observer.observe(textPageRef.current);
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
    [stageRef, textPageRef, canvasRef, epubRef].forEach((ref) => { if (ref.current) observer.observe(ref.current); });
    return () => observer.disconnect();
  }, [activeDoc?.id, activeDoc?.kind, currentPage, pdfState.loading, zoom]);

  const goToPage = useCallback(async (page) => {
    if (!activeDoc) return;
    const forward = page > currentPage;
    const next = Math.min(Math.max(page, 1), totalPages);
    if (activeDoc.kind === "epub") { const r = epubRenditionRef.current; if (r) await turnEpubPage(r, forward); return; }
    if (stageRef.current) stageRef.current.scrollTop = 0;
    await persistDoc({ ...activeDoc, page: next });
  }, [activeDoc, currentPage, totalPages]);

  useEffect(() => {
    const handler = (event) => {
      if (!activeDoc || isFolderDialogOpen || extractedPage) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); goToPage(currentPage + 1); }
      if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); goToPage(currentPage - 1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeDoc, currentPage, extractedPage, goToPage, isFolderDialogOpen]);

  useEffect(() => { setPageInput(String(currentPage)); }, [currentPage, activeId]);

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "pdf") return;
    let cancelled = false; let loadingTask;
    async function renderPdf() {
      setPdfState((s) => ({ ...s, loading: true, error: "" }));
      try {
        loadingTask = pdfjsLib.getDocument({ data: activeDoc.buffer.slice(0) });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(currentPage);
        const baseVp = page.getViewport({ scale: 1 });
        const stage = stageRef.current;
        const railW = window.innerWidth <= 600 ? 0 : 176;
        const availW = Math.max((stage?.clientWidth || 900) - railW, 1);
        const scale = zoomMode === FIT ? availW / baseVp.width : manualZoom;
        const vp = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        if (!cancelled) {
          setPdfState({ loading: false, pageCount: pdf.numPages, error: "" });
          if (activeDoc.pageCount !== pdf.numPages) persistDoc({ ...activeDoc, pageCount: pdf.numPages }, false);
        }
      } catch {
        if (!cancelled) setPdfState({ loading: false, pageCount: activeDoc.pageCount || 0, error: "Unable to render this PDF." });
      }
    }
    renderPdf();
    return () => { cancelled = true; loadingTask?.destroy?.(); };
  }, [activeDoc?.id, currentPage, manualZoom, zoomMode]);

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "epub" || !epubRef.current) return;
    let cancelled = false;
    const book = ePub(activeDoc.buffer.slice(0));
    book.spine.hooks.content.register((doc) => {
      [...doc.getElementsByTagName("*")].forEach((el) => { if (el.localName?.toLowerCase() === "script") el.remove(); });
    });
    const rendition = book.renderTo(epubRef.current, { width: "100%", height: "100%", flow: "paginated", spread: "none", manager: ReaderViewManager });
    epubRenditionRef.current = rendition;
    applyEpubTheme(rendition, theme);
    setEpubState({ loading: true, chapter: 0, chapterCount: 0, page: 0, pageCount: activeDoc.pageCount || 0, error: "" });

    let touchStart;
    rendition.hooks.content.register((contents) => {
      contents.document.addEventListener("touchstart", (e) => { const t = e.touches[0]; touchStart = t && { x: t.clientX, y: t.clientY }; }, { passive: true });
      contents.document.addEventListener("touchend", (e) => {
        const t = e.changedTouches[0]; if (!touchStart || !t) return;
        const { x, y } = touchStart; touchStart = null;
        if (Math.abs(t.clientX - x) < 64 || Math.abs(t.clientX - x) <= Math.abs(t.clientY - y)) return;
        turnEpubPage(rendition, t.clientX < x);
      }, { passive: true });
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

    Promise.resolve().then(() => book.ready).then(() => rendition.display(activeDoc.epubCfi))
      .catch(() => !cancelled && setEpubState({ loading: false, pageCount: 0, error: "Unable to render this EPUB." }));
    return () => { cancelled = true; epubRenditionRef.current = null; rendition.destroy(); book.destroy(); };
  }, [activeDoc?.id]);

  useEffect(() => {
    listDocs().then((items) => { setDocs(items); setActiveId(items[0]?.id || null); });
  }, []);

  async function persistDoc(nextDoc, touch = true) {
    const updated = { ...nextDoc, updatedAt: touch ? Date.now() : nextDoc.updatedAt };
    setDocs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    await saveDoc(updated);
  }

  const handleSwipeStart = useCallback((event) => {
    if (window.innerWidth > 524 || event.target.closest("button, input, select, label")) return;
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleSwipeEnd = useCallback((event) => {
    const start = swipeStartRef.current; swipeStartRef.current = null;
    if (!start || !activeDoc) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy)) return;
    goToPage(currentPage + (dx < 0 ? 1 : -1));
  }, [activeDoc, currentPage, goToPage]);

  async function syncWithGoogle() {
    if (!/^https?:$/.test(location.protocol)) { setMessage("Google Drive sync is available from the Vercel web app. Packaged macOS OAuth is not configured yet."); return; }
    if (!GOOGLE_CLIENT_ID) { setMessage("Add VITE_GOOGLE_CLIENT_ID in Vercel to enable Google Drive sync."); return; }
    setIsSyncing(true);
    try {
      await loadGoogleIdentity();
      const token = await requestDriveToken(GOOGLE_CLIENT_ID);
      const files = await listDriveFiles(token);
      const manifestFiles = files.filter((f) => f.name === googleDriveManifestName);
      const manifests = await Promise.all(manifestFiles.map(async (f) => JSON.parse(new TextDecoder().decode(await downloadDriveFile(token, f.id)))));
      const remote = manifests.reduce((lib, next) => {
        const docsMap = new Map(lib.docs.map((d) => [d.id, d]));
        for (const doc of next.docs || []) { if (!docsMap.has(doc.id) || doc.updatedAt >= docsMap.get(doc.id).updatedAt) docsMap.set(doc.id, doc); }
        const dd = { ...lib.deletedDocs, ...next.deletedDocs };
        for (const [id, time] of Object.entries(next.deletedDocs || {})) dd[id] = Math.max(time, lib.deletedDocs[id] || 0);
        return { docs: [...docsMap.values()], folders: [...new Set([...lib.folders, ...(next.folders || [])])], deletedDocs: dd };
      }, { docs: [], folders: [], deletedDocs: {} });
      if (!manifestFiles[0] && !docs.length) { setMessage("No Drive library found yet. Sync the device that has your files first."); return; }
      const mergedDeletions = { ...remote.deletedDocs, ...deletedDocs };
      for (const [id, time] of Object.entries(remote.deletedDocs || {})) mergedDeletions[id] = Math.max(time, deletedDocs[id] || 0);
      const remoteDocs = new Map((remote.docs || []).map((d) => [d.id, d]));
      const localDocs = new Map(docs.map((d) => [d.id, d]));
      const mergedDocs = [];
      for (const id of new Set([...remoteDocs.keys(), ...localDocs.keys()])) {
        const local = localDocs.get(id), remoteDoc = remoteDocs.get(id);
        const newest = !remoteDoc || (local && local.updatedAt >= remoteDoc.updatedAt) ? local : remoteDoc;
        if (newest && (mergedDeletions[id] || 0) < newest.updatedAt) mergedDocs.push({ ...remoteDoc, ...local, ...newest, remoteFileId: newest.remoteFileId || remoteDoc?.remoteFileId || local?.remoteFileId });
      }
      for (const doc of mergedDocs) {
        const remoteDoc = remoteDocs.get(doc.id), local = localDocs.get(doc.id);
        if (local && (!remoteDoc || local.updatedAt > remoteDoc.updatedAt || !remoteDoc.remoteFileId)) {
          doc.remoteFileId = await uploadDriveFile(token, { id: doc.remoteFileId, name: `minimal-reader-${doc.id}`, data: local.buffer, type: mimeType(doc.kind) });
          doc.buffer = local.buffer;
        } else if (doc.remoteFileId) { doc.buffer = await downloadDriveFile(token, doc.remoteFileId); }
      }
      const nextFolders = [...new Set([...(remote.folders || []), ...customFolders])];
      const manifest = { docs: mergedDocs.map(({ buffer, ...doc }) => doc), folders: nextFolders, deletedDocs: mergedDeletions };
      await uploadDriveFile(token, { id: manifestFiles[0]?.id, name: googleDriveManifestName, data: JSON.stringify(manifest), type: "application/json" });
      await clearDocs();
      for (const doc of mergedDocs) await saveDoc(doc);
      setDocs(mergedDocs.sort((a, b) => b.updatedAt - a.updatedAt));
      setActiveId((id) => mergedDocs.some((d) => d.id === id) ? id : mergedDocs[0]?.id || null);
      setCustomFolders(nextFolders); setDeletedDocs(mergedDeletions);
      setMessage(`Google Drive sync complete: ${mergedDocs.length} file${mergedDocs.length === 1 ? "" : "s"}.`);
    } catch (error) { setMessage(error.message || "Google Drive sync failed."); } finally { setIsSyncing(false); }
  }

  async function handleImport(event) {
    const files = [...event.target.files]; event.target.value = ""; if (!files.length) return;
    let lastImportedId = null, count = 0;
    for (const file of files) {
      const kind = fileKind(file);
      if (kind === "unknown") { setMessage(`${file.name} is not a supported file type.`); continue; }
      let extracted;
      try { extracted = await extractDocument(file, kind); } catch { setMessage(`Unable to read ${file.name}.`); continue; }
      const doc = { id: uid(), name: file.name, kind, folder, page: 1, pageCount: kind === "pdf" || kind === "epub" ? 0 : splitPages(extracted.text).length, text: extracted.text, buffer: extracted.buffer, size: file.size, createdAt: Date.now(), updatedAt: Date.now() };
      await saveDoc(doc); lastImportedId = doc.id; count++;
    }
    const items = await listDocs(); setDocs(items); setActiveId(lastImportedId);
    setMessage(`${count} file${count === 1 ? "" : "s"} imported.`);
  }

  function createFolder() { setFolderName(""); setIsFolderDialogOpen(true); }
  function confirmCreateFolder(event) {
    event.preventDefault(); const clean = folderName.trim(); if (!clean) return;
    setCustomFolders((items) => items.includes(clean) ? items : [...items, clean]);
    setFolder(clean); setActiveId(null); setIsFolderDialogOpen(false); setMessage(`Folder "${clean}" created.`);
  }
  async function moveActiveDoc(nextFolder) { if (!activeDoc) return; await persistDoc({ ...activeDoc, folder: nextFolder }); setFolder(nextFolder); }
  function changeZoom(direction) {
    if (zoomMode === FIT) { setZoomMode("manual"); setManualZoom(direction > 0 ? 1.15 : 0.85); return; }
    const idx = manualZooms.reduce((best, v, i) => Math.abs(v - manualZoom) < Math.abs(manualZooms[best] - manualZoom) ? i : best, 0);
    setManualZoom(manualZooms[Math.min(Math.max(idx + direction, 0), manualZooms.length - 1)]);
  }
  async function deleteActiveDoc() {
    if (!activeDoc) return;
    await removeDoc(activeDoc.id);
    setDeletedDocs((d) => ({ ...d, [activeDoc.id]: Date.now() }));
    const remaining = docs.filter((d) => d.id !== activeDoc.id); setDocs(remaining); setActiveId(remaining[0]?.id || null);
  }
  async function deleteLibrary() {
    if (!docs.length) return;
    if (!window.confirm("Delete every document in your library? This cannot be undone.")) return;
    await clearDocs();
    setDeletedDocs((d) => ({ ...d, ...Object.fromEntries(docs.map((doc) => [doc.id, Date.now()])) }));
    setDocs([]); setActiveId(null); setMessage("Library deleted.");
  }
  async function extractCurrentPageText() {
    if (!activeDoc || isExtractingPage) return;
    setIsExtractingPage(true);
    try {
      let text = "";
      if (activeDoc.kind === "pdf") {
        const lt = pdfjsLib.getDocument({ data: activeDoc.buffer.slice(0) });
        try { const pdf = await lt.promise; const page = await pdf.getPage(currentPage); text = await page.getTextContent().then((c) => c.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim()); } finally { lt.destroy?.(); }
      } else if (activeDoc.kind === "epub") {
        text = epubRef.current?.querySelector("iframe")?.contentDocument?.body?.innerText || "";
      } else { text = textPages[currentPage - 1] || ""; }
      setExtractedPage({ page: currentPage, text: text || "No readable text was found on this page." });
    } catch { setMessage("Unable to extract text from this page."); } finally { setIsExtractingPage(false); }
  }

  return {
    state: {
      docs, theme, customFolders, isSidebarCollapsed, isReaderChromeHidden, activeId, folder,
      pageInput, zoomMode, manualZoom, fitZoom, pageRailHeight, pdfState, epubState, message,
      isFolderDialogOpen, folderName, extractedPage, isExtractingPage, deletedDocs, isSyncing
    },
    derived: { folders, visibleDocs, activeDoc, textPages, totalPages, currentPage, zoom },
    refs: { canvasRef, epubRef, stageRef, textPageRef },
    setters: {
      setTheme, setIsSidebarCollapsed, setIsReaderChromeHidden, setActiveId, setFolder,
      setPageInput, setZoomMode, setManualZoom, setFolderName, setIsFolderDialogOpen, setExtractedPage
    },
    handlers: {
      goToPage, handleSwipeStart, handleSwipeEnd, syncWithGoogle, handleImport,
      createFolder, confirmCreateFolder, moveActiveDoc, changeZoom, deleteActiveDoc, deleteLibrary, extractCurrentPageText
    },
    formatDate
  };
}
