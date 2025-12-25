import "./App.css";
import { Layout } from "./app/Layout";
import { Viewer } from "./viewer/Viewer";
import { Sidebar } from "./ui/Sidebar";
import { Toolbar } from "./ui/Toolbar";
import { AppProvider } from "./state/store";

export default function App() {
  return (
    <AppProvider>
      <Layout
        toolbar={<Toolbar />}
        sidebar={<Sidebar />}
        viewer={<Viewer />}
      />
    </AppProvider>
  );
}
