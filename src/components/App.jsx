import useReader from "../hooks/useReader.js";
import Sidebar from "./Sidebar.jsx";
import Reader from "./Reader.jsx";
import { ExtractDialog, FolderDialog } from "./Dialogs.jsx";

export default function App() {
  const { state, derived, setters, handlers, refs, formatDate } = useReader();
  const { isSidebarCollapsed, isFolderDialogOpen, folderName, extractedPage } = state;
  const { setIsFolderDialogOpen, setFolderName, setExtractedPage, setMessage } = setters;
  const { confirmCreateFolder } = handlers;

  const sidebarProps = { state, derived, setters, handlers: { ...handlers, formatDate } };
  const readerProps = { state, derived, setters, handlers, refs, onClearMessage: () => setMessage("") };

  return (
    <main className={isSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <Sidebar {...sidebarProps} />
      <Reader {...readerProps} />
      {extractedPage && <ExtractDialog page={extractedPage.page} text={extractedPage.text} onClose={() => setExtractedPage(null)} />}
      {isFolderDialogOpen && <FolderDialog folderName={folderName} setFolderName={setFolderName} onClose={() => setIsFolderDialogOpen(false)} onSubmit={confirmCreateFolder} />}
    </main>
  );
}
