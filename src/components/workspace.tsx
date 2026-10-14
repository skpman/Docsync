"use client";

import { useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";

const initialContent = `
  <h1>Untitled document</h1>
  <p>Start writing. Your work is saved locally, even when you go offline.</p>
  <h2>Welcome to DocSync</h2>
  <p>This is the offline-first foundation for your collaborative workspace.</p>`;

type FormatAction = "bold" | "italic" | "bulletList" | "orderedList";

export function Workspace() {
  const [isOnline, setIsOnline] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"local" | "connecting" | "connected">("local");
  const [collaboratorCount, setCollaboratorCount] = useState(0);
  const documentId = "starter-document";
  const ydoc = useMemo(() => new Y.Doc(), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Typography,
      Collaboration.configure({ document: ydoc }),
      Placeholder.configure({ placeholder: "Write something…" }),
    ],
    immediatelyRender: false,
    editorProps: { attributes: { class: "editor" } },
    onUpdate: () => {
      setIsSaved(false);
      window.setTimeout(() => setIsSaved(true), 600);
    },
  });

  useEffect(() => {
    const persistence = new IndexeddbPersistence(`docsync:${documentId}`, ydoc);
    persistence.once("synced", () => {
      setIsSaved(true);
    });
    const updateNetwork = () => setIsOnline(navigator.onLine);
    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    return () => {
      persistence.destroy();
      ydoc.destroy();
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, [documentId, ydoc]);

  useEffect(() => {
    if (!editor || ydoc.getXmlFragment("default").length > 0) return;
    editor.commands.setContent(initialContent);
  }, [editor, ydoc]);

  useEffect(() => {
    const syncUrl = process.env.NEXT_PUBLIC_COLLAB_URL;
    if (!syncUrl) return;

    const provider = new WebsocketProvider(syncUrl, `docsync:${documentId}`, ydoc);
    provider.awareness.setLocalStateField("user", { name: "You", color: "#5b5ce2" });

    const updateStatus = ({ status }: { status: "connecting" | "connected" | "disconnected" }) => {
      setSyncStatus(status === "connected" ? "connected" : "connecting");
    };
    const updateCollaborators = () => setCollaboratorCount(Math.max(0, provider.awareness.getStates().size - 1));

    setSyncStatus("connecting");
    provider.on("status", updateStatus);
    provider.awareness.on("change", updateCollaborators);
    updateCollaborators();

    return () => {
      provider.off("status", updateStatus);
      provider.awareness.off("change", updateCollaborators);
      provider.destroy();
    };
  }, [documentId, ydoc]);

  const applyFormat = (action: FormatAction) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (action === "bold") chain.toggleBold().run();
    if (action === "italic") chain.toggleItalic().run();
    if (action === "bulletList") chain.toggleBulletList().run();
    if (action === "orderedList") chain.toggleOrderedList().run();
  };

  const title = editor?.getText().split("\n")[0] || "Untitled document";

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-white px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-[var(--primary)] font-bold text-white">D</div>
          <div>
            <p className="m-0 text-sm font-semibold">DocSync</p>
            <p className="m-0 text-xs text-[var(--muted)]">{title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className={`size-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-amber-400"}`} />
          {!isOnline ? "Offline — changes queued" : syncStatus === "connected" ? `Live sync · ${collaboratorCount} collaborator${collaboratorCount === 1 ? "" : "s"}` : isSaved ? "Saved locally" : "Saving…"}
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-6 px-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)_220px] sm:px-8">
        <aside className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm shadow-sm">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[.12em] text-[var(--muted)]">Documents</p>
          <button className="w-full rounded-lg bg-[#efefff] px-3 py-2 text-left font-medium text-[#4748bb]">{title}</button>
          <button className="mt-2 w-full rounded-lg px-3 py-2 text-left text-[var(--muted)] hover:bg-slate-50">+ New document</button>
        </aside>

        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-sm">
          <div className="flex flex-wrap gap-1 border-b border-[var(--line)] px-4 py-2">
            {(["bold", "italic", "bulletList", "orderedList"] as FormatAction[]).map((action) => (
              <button key={action} onClick={() => applyFormat(action)} className="rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-slate-100" aria-label={action}>
                {action === "bold" ? "B" : action === "italic" ? "I" : action === "bulletList" ? "• List" : "1. List"}
              </button>
            ))}
          </div>
          <div className="px-7 py-10 sm:px-14"><EditorContent editor={editor} /></div>
        </section>

        <aside className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm shadow-sm">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[.12em] text-[var(--muted)]">Collaborators</p>
          <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-[#e4e5ff] font-semibold text-[#4748bb]">Y</span><span>You <small className="text-[var(--muted)]">editing</small></span></div>
          <p className="mt-6 text-xs leading-5 text-[var(--muted)]">{syncStatus === "local" ? "Set NEXT_PUBLIC_COLLAB_URL to enable live cursors and presence." : syncStatus === "connected" ? "Your CRDT document is synchronizing in real time." : "Connecting to the collaboration service…"}</p>
        </aside>
      </section>
    </main>
  );
}
