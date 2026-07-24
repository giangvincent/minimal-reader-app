import * as svgIcons from "../svg-icons.jsx";

export function ExtractDialog({ page, text, onClose }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="text-extract-dialog" aria-labelledby="text-extract-title" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="text-extract-header">
          <h3 id="text-extract-title">Page {page} text</h3>
          <button className="icon-button" onClick={onClose} title="Close"><svgIcons.CloseIcon /></button>
        </div>
        <pre>{text}</pre>
      </section>
    </div>
  );
}

export function FolderDialog({ folderName, setFolderName, onClose, onSubmit }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="folder-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h3>Create folder</h3>
        <input autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name" />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
