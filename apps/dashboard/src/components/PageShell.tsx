import type { ReactNode } from "react";

/** The common frame of an app screen: a title, one line saying what it does, then the content. */
export function PageShell({ title, lead, width = 640, children }: { title: string; lead: string; width?: number; children: ReactNode }) {
  return (
    <main className="mx-auto flex flex-col gap-6 px-4 py-8 min-[800px]:px-8" style={{ maxWidth: width }}>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-28 font-bold">{title}</h1>
        <p className="text-14 text-mute">{lead}</p>
      </header>
      {children}
    </main>
  );
}
