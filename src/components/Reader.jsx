import * as svgIcons from "../svg-icons.jsx";
import { FIT } from "../constants/appConstants.jsx";

export default function Reader({ state, derived, setters, handlers, refs, onClearMessage }) {
  const { docs, isSidebarCollapsed, isReaderChromeHidden, isReadingFocused, isExtractingPage, theme, message, pageInput, zoomMode, pageRailHeight, pdfState, epubState } = state;
  const { activeDoc, textPages, totalPages, currentPage, zoom, folders } = derived;
  const { setIsSidebarCollapsed, setIsReadingFocused, setTheme, setZoomMode, setPageInput } = setters;
  const { goToPage, extractCurrentPageText, changeZoom, deleteActiveDoc, moveActiveDoc, handleSwipeStart, handleSwipeEnd } = handlers;
  const { canvasRef, epubRef, stageRef, textPageRef } = refs;

  return (
    <section className="reader">
      <header className={isReaderChromeHidden ? "toolbar reader-chrome-hidden" : "toolbar"}>
        <div className="title-block">
          <button className="icon-button toolbar-sidebar-toggle" onClick={() => setIsSidebarCollapsed((v) => !v)} title={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}><svgIcons.ChevronLeftIcon /></button>
          <button className="icon-button reading-focus-toggle" onClick={() => setIsReadingFocused((v) => !v)} title={isReadingFocused ? "Show controls" : "Focus reading"}>UI</button>
          <h2>{activeDoc?.name || "No document selected"}</h2>
        </div>
        <div className={isReadingFocused ? "toolbar-actions reading-focused" : "toolbar-actions"}>
          {activeDoc && (
            <select value={activeDoc.folder || "Library"} onChange={(e) => moveActiveDoc(e.target.value)} title="Move to folder">
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
        {activeDoc && <>
          <button className="side-page-button side-page-button-left" onClick={() => goToPage(currentPage - 1)} disabled={activeDoc?.kind !== "epub" && currentPage <= 1} title="Previous page (ArrowLeft or PageUp)"><svgIcons.ChevronLeftIcon /></button>
          <button className="side-page-button side-page-button-right" onClick={() => goToPage(currentPage + 1)} disabled={activeDoc?.kind !== "epub" && currentPage >= totalPages} title="Next page (ArrowRight, Space, or PageDown)"><svgIcons.ChevronRightIcon /></button>
        </>}
      </div>

      <div className={zoomMode === FIT ? "stage" : "stage manual-zoom"} ref={stageRef} style={{ "--page-rail-height": `${pageRailHeight}px` }} onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
        {!activeDoc && <div className="welcome"><h3>{docs.length ? "This folder is empty" : "Import a PDF, DOCX, DOC, or TXT file"}</h3><p>{docs.length ? "Import a file here or move a document into this folder." : "Your library stays local in this browser or desktop app. No login is required."}</p></div>}
        {activeDoc?.kind === "pdf" && <div className="pdf-page">{pdfState.loading && <span className="loading">Loading page...</span>}{pdfState.error && <span className="loading">{pdfState.error}</span>}<canvas ref={canvasRef} /></div>}
        {activeDoc?.kind === "epub" && <div className="epub-page">{epubState.loading && <span className="loading">Loading book...</span>}{epubState.error && <span className="loading">{epubState.error}</span>}<div ref={epubRef} /></div>}
        {activeDoc && activeDoc.kind !== "pdf" && activeDoc.kind !== "epub" && <article className="text-page" ref={textPageRef} style={{ transform: `scale(${zoom})` }}><pre>{textPages[currentPage - 1]}</pre></article>}
      </div>

      {activeDoc && (
        <footer className={(isReaderChromeHidden || isReadingFocused) ? "page-float reader-chrome-hidden" : "page-float"}>
          <button onClick={() => goToPage(currentPage - 1)} disabled={activeDoc.kind !== "epub" && currentPage <= 1}>Prev</button>
          <button onClick={extractCurrentPageText} disabled={isExtractingPage}>{isExtractingPage ? "Extracting..." : "Extract text"}</button>
          {activeDoc.kind === "epub"
            ? <span className="epub-location">Chapter {epubState.chapter || 1} / {epubState.chapterCount || 1} · Page {currentPage} / {totalPages}</span>
            : <form onSubmit={(e) => { e.preventDefault(); goToPage(Number(pageInput)); }}>
                <input inputMode="numeric" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))} />
                <span>/ {totalPages}</span>
              </form>}
          <button onClick={() => goToPage(currentPage + 1)} disabled={activeDoc.kind !== "epub" && currentPage >= totalPages}>Next</button>
        </footer>
      )}

      <button className="theme-toggle" onClick={() => setTheme((v) => v === "dark" ? "light" : "dark")} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        <span aria-hidden="true">{theme === "dark" ? <svgIcons.SunIcon /> : <svgIcons.MoonIcon />}</span>
      </button>

      {message && <div className="toast" onAnimationEnd={onClearMessage}>{message}</div>}
    </section>
  );
}
