
import { useState } from "react";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

interface AuthUser {
  id: number;
  fullName: string;
  username: string;
  role: string;
  schoolId: number | null;
  directorateId: number | null;
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  if (!token || !user) {
    return (
      <LoginPage
        onLogin={(loginToken, loginUser) => {
          setToken(loginToken);
          setUser(loginUser);
        }}
      />
    );
  }

  return (
    <HomePage
      token={token}
      user={user}
      onLogout={() => {
        setToken(null);
        setUser(null);
      }}
    />
  );
}

export default App;
