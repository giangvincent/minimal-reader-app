import * as svgIcons from "../svg-icons.jsx";

export default function Sidebar({ state, derived, setters, handlers }) {
  const { docs, isSidebarCollapsed, isReaderChromeHidden, isSyncing, folder } = state;
  const { folders, visibleDocs, activeDoc } = derived;
  const { setIsSidebarCollapsed, setIsReaderChromeHidden, setActiveId, setFolder } = setters;
  const { handleImport, syncWithGoogle, deleteLibrary, createFolder, formatDate } = handlers;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-copy">
          <h1>Minimal Reader</h1>
          <p>{docs.length} document{docs.length === 1 ? "" : "s"}</p>
        </div>
        <button className="icon-button sidebar-toggle" onClick={() => setIsSidebarCollapsed((v) => !v)} title={isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}><svgIcons.ChevronLeftIcon /></button>
        <button className="icon-button create-folder-button" onClick={createFolder} title="Create folder"><svgIcons.PlusIcon /></button>
      </div>
      <label className="sidebar-button import-button">
        <input accept=".pdf,.txt,.doc,.docx,.epub,application/pdf,application/epub+zip,text/plain" multiple onChange={handleImport} type="file" />
        Import
      </label>
      <button className="sidebar-button sync-button" onClick={syncWithGoogle} disabled={isSyncing}>{isSyncing ? "Syncing..." : "Sync Drive"}</button>
      <button className="sidebar-button delete-library-button" onClick={deleteLibrary} disabled={!docs.length}>Delete library</button>
      <nav className="folders" aria-label="Folders">
        {folders.map((item) => (
          <button className={item === folder ? "active" : ""} key={item} onClick={() => setFolder(item)}>
            <span>{item}</span><small>{docs.filter((doc) => (doc.folder || "Library") === item).length}</small>
          </button>
        ))}
      </nav>
      <div className="document-list">
        {visibleDocs.map((doc) => (
          <button className={doc.id === activeDoc?.id ? "doc active" : "doc"} key={doc.id} onClick={() => { setActiveId(doc.id); setIsSidebarCollapsed(true); }}>
            <strong>{doc.name}</strong><span>{doc.kind.toUpperCase()} · p. {doc.page || 1} · {formatDate(doc.updatedAt)}</span>
          </button>
        ))}
        {!visibleDocs.length && <p className="empty">Import files or create a folder to begin.</p>}
      </div>
      <button className="icon-button reader-chrome-toggle" onClick={() => setIsReaderChromeHidden((v) => !v)} title={isReaderChromeHidden ? "Show reader controls" : "Hide reader controls"}>UI</button>
    </aside>
  );
}
