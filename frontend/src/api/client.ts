import axios from "axios";

// API base URLs configured via environment variables
// Falls back to localhost for local development
const IAM_BASE_URL =
  import.meta.env.VITE_IAM_API_URL || "http://localhost:3001";
const PRODUCT_BASE_URL =
  import.meta.env.VITE_PRODUCT_API_URL || "http://localhost:3002";
const ORDER_BASE_URL =
  import.meta.env.VITE_ORDER_API_URL || "http://localhost:3003";

export const IAM_API = axios.create({
  baseURL: IAM_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

export const PRODUCT_API = axios.create({
  baseURL: PRODUCT_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

export const ORDER_API = axios.create({
  baseURL: ORDER_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Helper to set Auth Token
export const setAuthToken = (token: string | null) => {
  if (token) {
    IAM_API.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    PRODUCT_API.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    ORDER_API.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete IAM_API.defaults.headers.common["Authorization"];
    delete PRODUCT_API.defaults.headers.common["Authorization"];
    delete ORDER_API.defaults.headers.common["Authorization"];
  }
};

