import { jwtDecode } from "jwt-decode";
import React, { useState } from "react";
import { setAuthToken } from "../api/client";
import { AuthContext } from "../context/AuthContext";
import type { AuthResponse, User } from "../types";

interface JWTPayload {
  exp: number;
  [key: string]: unknown;
}

// Extract initialization logic
function getInitialAuthState(): { token: string | null; user: User | null } {
  if (typeof window === "undefined") {
    return { token: null, user: null };
  }

  const storedToken = localStorage.getItem("token");
  const storedUser = localStorage.getItem("user");

  if (!storedToken || !storedUser) {
    return { token: null, user: null };
  }

  try {
    const decoded = jwtDecode<JWTPayload>(storedToken);
    if (decoded.exp * 1000 < Date.now()) {
      // Token expired
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      return { token: null, user: null };
    }

    setAuthToken(storedToken); // Set on API client during init
    return { token: storedToken, user: JSON.parse(storedUser) };
  } catch {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return { token: null, user: null };
  }
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authState, setAuthState] = useState(getInitialAuthState);

  const logout = () => {
    setAuthState({ token: null, user: null });
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuthToken(null);
  };

  const login = (data: AuthResponse) => {
    setAuthState({ token: data.token, user: data.user });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setAuthToken(data.token);
  };

  return (
    <AuthContext.Provider
      value={{
        user: authState.user,
        token: authState.token,
        login,
        logout,
        isAuthenticated: !!authState.token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

