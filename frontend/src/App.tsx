import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/RequireAuth";
import MainLayout from "./layouts/MainLayout";
import { NAV_ITEMS } from "./config/navigation";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MonthlyReport from "./pages/MonthlyReport";
import DirectorateRequests from "./pages/DirectorateRequests";

const roles = (path: string) => NAV_ITEMS.find((i) => i.path === path)?.roles ?? "ALL";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <MainLayout />
              </RequireAuth>
            }
          >
            <Route index element={<HomePage />} />
            <Route
              path="reports/monthly"
              element={<RequireAuth roles={roles("/reports/monthly")}><MonthlyReport /></RequireAuth>}
            />
            <Route
              path="requests/review"
              element={<RequireAuth roles={roles("/requests/review")}><DirectorateRequests /></RequireAuth>}
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
