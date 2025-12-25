import type { ReactNode } from "react";

type LayoutProps = {
  toolbar: ReactNode;
  sidebar: ReactNode;
  viewer: ReactNode;
};

export const Layout = ({ toolbar, sidebar, viewer }: LayoutProps) => {
  return (
    <div className="app-shell">
      <header className="app-toolbar">{toolbar}</header>
      <div className="app-body">
        <aside className="app-sidebar">{sidebar}</aside>
        <main className="app-viewer">{viewer}</main>
      </div>
    </div>
  );
};
