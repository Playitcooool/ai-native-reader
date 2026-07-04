type IconName = "home" | "books" | "contents" | "ask" | "prev" | "next" | "search" | "moon" | "sun" | "minus" | "plus" | "close" | "pen" | "eraser" | "gear";

export function Icon({ name }: { name: IconName }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, JSX.Element> = {
    books: <><path d="M4 19.5V5a2 2 0 0 1 2-2h11" /><path d="M6 17h13" /><path d="M6 21h13V7H6a2 2 0 0 0 0 4" /></>,
    contents: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /><path d="M8 6v12" /></>,
    home: <><path d="m15 18-6-6 6-6" /><path d="M20 12H9" /><path d="M5 19V5" /></>,
    ask: <><path d="M12 3a7 7 0 0 1 7 7c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 7-7Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    prev: <><path d="m15 18-6-6 6-6" /></>,
    next: <><path d="m9 18 6-6-6-6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    moon: <><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.3 17.7-1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /></>,
    minus: <><path d="M5 12h14" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
    pen: <><path d="m12 19 7-7 3 3-7 7-3 .5.5-3.5Z" /><path d="m18 13-7-7 2-2a2.1 2.1 0 0 1 3 0l4 4a2.1 2.1 0 0 1 0 3Z" /><path d="m2 22 5-5" /></>,
    eraser: <><path d="m7 21-4-4a2.1 2.1 0 0 1 0-3L14 3a2.1 2.1 0 0 1 3 0l4 4a2.1 2.1 0 0 1 0 3L10 21Z" /><path d="M22 21H7" /><path d="m5 12 7 7" /></>,
    gear: <><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.07 14H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.07V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.37 9c.1.32.36.73 1.56 1H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}
