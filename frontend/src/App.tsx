import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/RequireAuth";
import MainLayout from "./layouts/MainLayout";
import { NAV_ITEMS } from "./config/navigation";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import MonthlyReport from "./pages/MonthlyReport";
import DirectorateRequests from "./pages/DirectorateRequests";
import SchoolsPage from "./pages/SchoolsPage";
import StaffPage from "./pages/StaffPage";
import StudentsPage from "./pages/StudentsPage";
import UsersPage from "./pages/UsersPage";
import GradesPage from "./pages/GradesPage";
import TimetablePage from "./pages/TimetablePage";
import QuotaPage from "./pages/QuotaPage";
import MySchedulePage from "./pages/MySchedulePage";
import SettingsPage from "./pages/SettingsPage";
import AttendancePage from "./pages/AttendancePage";
import MyAttendancePage from "./pages/MyAttendancePage";
import FaceEnrollPage from "./pages/FaceEnrollPage";
import KioskPage from "./pages/KioskPage";
import SchoolRequestsPage from "./pages/SchoolRequestsPage";
import MessagesPage from "./pages/MessagesPage";

const roles = (path: string) => NAV_ITEMS.find((i) => i.path === path)?.roles ?? "ALL";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/welcome" element={<LandingPage />} />
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
            <Route path="attendance" element={<RequireAuth roles={roles("/attendance")}><AttendancePage /></RequireAuth>} />
            <Route path="kiosk" element={<RequireAuth roles={roles("/kiosk")}><KioskPage /></RequireAuth>} />
            <Route path="face-enroll" element={<RequireAuth roles={roles("/face-enroll")}><FaceEnrollPage /></RequireAuth>} />
            <Route path="my-attendance" element={<RequireAuth roles={roles("/my-attendance")}><MyAttendancePage /></RequireAuth>} />
            <Route path="timetable" element={<RequireAuth roles={roles("/timetable")}><TimetablePage /></RequireAuth>} />
            <Route path="quota" element={<RequireAuth roles={roles("/quota")}><QuotaPage /></RequireAuth>} />
            <Route path="my-schedule" element={<RequireAuth roles={roles("/my-schedule")}><MySchedulePage /></RequireAuth>} />
            <Route path="settings" element={<RequireAuth roles={roles("/settings")}><SettingsPage /></RequireAuth>} />
            <Route path="grades" element={<RequireAuth roles={roles("/grades")}><GradesPage /></RequireAuth>} />
            <Route path="users" element={<RequireAuth roles={roles("/users")}><UsersPage /></RequireAuth>} />
            <Route
              path="reports/monthly"
              element={<RequireAuth roles={roles("/reports/monthly")}><MonthlyReport /></RequireAuth>}
            />
            <Route path="messages" element={<RequireAuth roles={roles("/messages")}><MessagesPage /></RequireAuth>} />
            <Route path="requests" element={<RequireAuth roles={roles("/requests")}><SchoolRequestsPage /></RequireAuth>} />
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
