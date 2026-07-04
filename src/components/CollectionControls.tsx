import { useMemo } from "react";
import type { Document } from "../stores/documentStore";
import {
  collectionIdsForDocument,
  RECENT_COLLECTION_ID,
  useDocumentStore,
} from "../stores/documentStore";
import { useToast } from "./Toast";

export function CollectionFilterChips({ documents }: { documents: Document[] }) {
  const {
    collections,
    documentCollections,
    selectedCollectionId,
    setSelectedCollectionId,
    createCollection,
  } = useDocumentStore();
  const { addToast } = useToast();
  const collectionCounts = useMemo(() => {
    const documentIds = new Set(documents.map((doc) => doc.id));
    const counts = new Map<string, number>();
    for (const membership of documentCollections) {
      if (!documentIds.has(membership.document_id)) continue;
      counts.set(membership.collection_id, (counts.get(membership.collection_id) ?? 0) + 1);
    }
    return counts;
  }, [documents, documentCollections]);
  const recentCount = useMemo(() => documents.filter((doc) => doc.last_opened_at).length, [documents]);

  const handleNewCollection = async () => {
    const name = window.prompt("New collection name");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ type: "error", message: "Collection name cannot be empty." });
      return;
    }
    try {
      const collection = await createCollection(trimmed);
      setSelectedCollectionId(collection.id);
      addToast({ type: "info", message: `Created ${collection.name}.` });
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Failed to create collection." });
    }
  };

  return (
    <div className="collection-chips" aria-label="Collection filter">
      <button
        className={`collection-chip ${selectedCollectionId === RECENT_COLLECTION_ID ? "active" : ""}`}
        onClick={() => setSelectedCollectionId(RECENT_COLLECTION_ID)}
      >
        <span className="collection-chip-name">Recent</span>
        <span className="collection-chip-count">{recentCount}</span>
      </button>
      <button
        className={`collection-chip ${selectedCollectionId === null ? "active" : ""}`}
        onClick={() => setSelectedCollectionId(null)}
      >
        <span className="collection-chip-name">All books</span>
        <span className="collection-chip-count">{documents.length}</span>
      </button>
      {collections.map((collection) => (
        <button
          key={collection.id}
          className={`collection-chip ${selectedCollectionId === collection.id ? "active" : ""}`}
          onClick={() => setSelectedCollectionId(collection.id)}
          title={collection.name}
        >
          <span className="collection-chip-name">{collection.name}</span>
          <span className="collection-chip-count">
            {collectionCounts.get(collection.id) ?? 0}
          </span>
        </button>
      ))}
      <button className="collection-chip" onClick={handleNewCollection}>
        <span className="collection-chip-name">New collection...</span>
      </button>
    </div>
  );
}

export function CollectionAssignmentMenu({ doc, onDone }: { doc: Document; onDone?: () => void }) {
  const {
    collections,
    documentCollections,
    createCollection,
    addDocumentToCollection,
    removeDocumentFromCollection,
  } = useDocumentStore();
  const { addToast } = useToast();
  const assignedIds = collectionIdsForDocument(documentCollections, doc.id);
  const errorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : typeof err === "string" ? err : fallback;

  const run = async (action: Promise<unknown>, message: string) => {
    try {
      await action;
      addToast({ type: "info", message });
      onDone?.();
    } catch (err) {
      addToast({ type: "error", message: errorMessage(err, "Collection update failed.") });
    }
  };

  const handleNewCollection = async () => {
    const name = window.prompt("New collection name");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ type: "error", message: "Collection name cannot be empty." });
      return;
    }
    try {
      const collection = await createCollection(trimmed);
      await addDocumentToCollection(doc.id, collection.id);
      addToast({ type: "info", message: `Added to ${collection.name}.` });
      onDone?.();
    } catch (err) {
      addToast({ type: "error", message: errorMessage(err, "Failed to create collection.") });
    }
  };

  return (
    <>
      <div className="ctx-menu-label">Collections</div>
      <button className="ctx-menu-item" role="menuitem" onClick={handleNewCollection}>
        New collection...
      </button>
      {collections.map((collection) => {
        const assigned = assignedIds.has(collection.id);
        return (
          <button
            key={collection.id}
            className="ctx-menu-item"
            role="menuitemcheckbox"
            aria-checked={assigned}
            onClick={() => run(
              assigned
                ? removeDocumentFromCollection(doc.id, collection.id)
                : addDocumentToCollection(doc.id, collection.id),
              assigned ? `Removed from ${collection.name}.` : `Added to ${collection.name}.`,
            )}
          >
            <span aria-hidden="true">{assigned ? "*" : ""}</span>
            {collection.name}
          </button>
        );
      })}
      <div className="ctx-menu-separator" />
    </>
  );
}
