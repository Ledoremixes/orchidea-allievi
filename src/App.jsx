import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AdminRoute from "./components/AdminRoute.jsx";
import AppShell from "./components/AppShell.jsx";
import Login from "./pages/Login.jsx";
import SetPassword from "./pages/SetPassword.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Tessera from "./pages/Tessera.jsx";
import Corsi from "./pages/Corsi.jsx";
import Pagamenti from "./pages/Pagamenti.jsx";
import Video from "./pages/Video.jsx";
import AdminPanel from "./pages/admin/AdminPanel.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/set-password" element={<SetPassword />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="tessera" element={<Tessera />} />
          <Route path="corsi" element={<Corsi />} />
          <Route path="pagamenti" element={<Pagamenti />} />
          <Route path="video" element={<Video />} />

          <Route element={<AdminRoute />}>
            <Route path="admin" element={<AdminPanel />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
