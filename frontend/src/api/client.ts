import axios from 'axios';

// Since we are running locally, we point to specific ports.
// In production, this would be an API Gateway URL.

export const IAM_API = axios.create({
  baseURL: 'http://localhost:3001',
  headers: { 'Content-Type': 'application/json' }
});

export const PRODUCT_API = axios.create({
  baseURL: 'http://localhost:3002',
  headers: { 'Content-Type': 'application/json' }
});

export const ORDER_API = axios.create({
  baseURL: 'http://localhost:3003',
  headers: { 'Content-Type': 'application/json' }
});

// Helper to set Auth Token
export const setAuthToken = (token: string | null) => {
  if (token) {
    IAM_API.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    PRODUCT_API.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    ORDER_API.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete IAM_API.defaults.headers.common['Authorization'];
    delete PRODUCT_API.defaults.headers.common['Authorization'];
    delete ORDER_API.defaults.headers.common['Authorization'];
  }
};
