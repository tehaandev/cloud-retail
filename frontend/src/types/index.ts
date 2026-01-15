export interface User {
  id: string;
  email: string;
  role: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  createdAt: string;
}

export interface Order {
  id: number;
  user_id: string;
  product_id: string;
  quantity: number;
  total_price: string;
  status: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
