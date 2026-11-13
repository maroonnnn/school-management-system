import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/RequireAuth";
import MainLayout from "./layouts/MainLayout";
import { NAV_ITEMS } from "./config/navigation";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MonthlyReport from "./pages/MonthlyReport";
import DirectorateRequests from "./pages/DirectorateRequests";
import SchoolsPage from "./pages/SchoolsPage";
import StaffPage from "./pages/StaffPage";
import StudentsPage from "./pages/StudentsPage";
import UsersPage from "./pages/UsersPage";
import GradesPage from "./pages/GradesPage";

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
            <Route path="schools" element={<RequireAuth roles={roles("/schools")}><SchoolsPage /></RequireAuth>} />
            <Route path="staff" element={<RequireAuth roles={roles("/staff")}><StaffPage /></RequireAuth>} />
            <Route path="students" element={<RequireAuth roles={roles("/students")}><StudentsPage /></RequireAuth>} />
            <Route path="grades" element={<RequireAuth roles={roles("/grades")}><GradesPage /></RequireAuth>} />
            <Route path="users" element={<RequireAuth roles={roles("/users")}><UsersPage /></RequireAuth>} />
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
