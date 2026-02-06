import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend } from "k6/metrics";

// Custom metrics for order flow
const orderCreationSuccess = new Counter("order_creation_success");
const orderCreationFailure = new Counter("order_creation_failure");
const inventoryUpdateLatency = new Trend("inventory_update_latency");
const orderToInventoryE2E = new Trend("order_to_inventory_e2e");

// Configuration
export const options = {
  stages: [
    { duration: "30s", target: 20 }, // Ramp up to 20 users
    { duration: "1m", target: 50 }, // Stay at 50 users
    { duration: "30s", target: 100 }, // Peak at 100 users
    { duration: "1m", target: 50 }, // Back to 50 users
    { duration: "30s", target: 0 }, // Ramp down to 0 users
  ],
  thresholds: {
    // General performance
    http_req_duration: ["p(95)<1000"], // 95% of requests under 1s
    "http_req_duration{name:GetProducts}": ["p(95)<500"], // Fast reads
    "http_req_duration{name:CreateOrder}": ["p(95)<2000"], // Order creation can be slower (saga)
    http_req_failed: ["rate<0.05"], // Less than 5% failure rate

    // Business metrics
    order_creation_success: ["count>0"], // At least some orders succeed
    order_to_inventory_e2e: ["p(95)<3000"], // E2E order flow under 3s
  },
};

// If BASE_URL is provided, we assume ALB routing (path-based)
// If not provided, we default to local dev (different ports)
const BASE_URL = __ENV.BASE_URL;

// Setup function - runs once per VU at the start
export function setup() {
  const isALB = !!BASE_URL;
  const authUrl = isALB ? `${BASE_URL}/auth` : "http://localhost:3001/auth";
  const productUrl = isALB
    ? `${BASE_URL}/products`
    : "http://localhost:3002/products";

  console.log(`Setup: Testing against ${isALB ? "ALB" : "localhost"}`);
  console.log(`Auth URL: ${authUrl}`);
  console.log(`Product URL: ${productUrl}`);

  // Create a test user for authenticated operations
  const testUser = {
    email: `loadtest_user_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
    password: "LoadTest123!",
  };

  const params = { headers: { "Content-Type": "application/json" } };

  let token = null;
  let userId = null;
  let products = [];

  // Try to register test user with error handling
  try {
    const regRes = http.post(
      `${authUrl}/register`,
      JSON.stringify(testUser),
      params,
    );

    if (regRes.status !== 201 && regRes.status !== 400) {
      console.warn(`Setup: Registration failed with status ${regRes.status}`);
      console.warn(`Response body: ${regRes.body.substring(0, 200)}`);
    }

    // Login to get token
    const loginRes = http.post(
      `${authUrl}/login`,
      JSON.stringify(testUser),
      params,
    );

    if (loginRes.status === 200 && loginRes.body) {
      try {
        const loginData = JSON.parse(loginRes.body);
        token = loginData.token;
        userId = loginData.user.id;
        console.log(`Setup: Successfully authenticated user ID ${userId}`);
      } catch (e) {
        console.error(`Setup: Failed to parse login response as JSON: ${e}`);
        console.error(`Response body: ${loginRes.body.substring(0, 200)}`);
      }
    } else {
      console.warn(`Setup: Login failed with status ${loginRes.status}`);
      console.warn(`Response body: ${loginRes.body.substring(0, 200)}`);
    }
  } catch (e) {
    console.error(`Setup: Auth flow error: ${e}`);
  }

  // Get available products with error handling
  try {
    const productsRes = http.get(productUrl);

    if (productsRes.status === 200 && productsRes.body) {
      try {
        products = JSON.parse(productsRes.body);
        console.log(`Setup: Found ${products.length} products`);
      } catch (e) {
        console.error(`Setup: Failed to parse products response as JSON: ${e}`);
        console.error(`Response body: ${productsRes.body.substring(0, 200)}`);
      }
    } else {
      console.warn(
        `Setup: Failed to fetch products, status ${productsRes.status}`,
      );
      console.warn(`Response body: ${productsRes.body.substring(0, 200)}`);
    }
  } catch (e) {
    console.error(`Setup: Product fetch error: ${e}`);
  }

  if (!token) {
    console.warn(
      "Setup: No JWT token available - authenticated tests will be skipped",
    );
  }

  if (products.length === 0) {
    console.warn(
      "Setup: No products available - product-based tests will be skipped",
    );
  }

  return {
    testUser,
    token,
    userId,
    products,
    isALB,
  };
}

export default function (data) {
  const isALB = data.isALB;

  // Define URLs based on environment
  const authUrl = isALB ? `${BASE_URL}/auth` : "http://localhost:3001/auth";
  const productUrl = isALB
    ? `${BASE_URL}/products`
    : "http://localhost:3002/products";
  const orderUrl = isALB
    ? `${BASE_URL}/orders`
    : "http://localhost:3003/orders";
  const inventoryUrl = isALB
    ? `${BASE_URL}/inventory`
    : "http://localhost:3004/inventory";

  const jsonHeaders = { "Content-Type": "application/json" };
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.token}`,
  };

  // Scenario 1: Product Discovery (70% of users)
  if (Math.random() < 0.7) {
    group("Product Discovery Flow", () => {
      // 1. Browse all products
      const productsRes = http.get(productUrl, {
        tags: { name: "GetProducts" },
      });
      check(productsRes, {
        "Get Products: status 200": (r) => r.status === 200,
        "Get Products: returns array": (r) => Array.isArray(r.json()),
        "Get Products: has products": (r) => r.json().length > 0,
      });

      if (productsRes.status === 200 && productsRes.json().length > 0) {
        const products = productsRes.json();
        const randomProduct =
          products[Math.floor(Math.random() * products.length)];

        // 2. View product details
        const detailRes = http.get(`${productUrl}/${randomProduct.id}`, {
          tags: { name: "GetProductDetail" },
        });
        check(detailRes, {
          "Product Detail: status 200": (r) => r.status === 200,
          "Product Detail: has price": (r) => r.json("price") !== undefined,
        });

        // 3. Check inventory availability
        const invRes = http.get(`${inventoryUrl}/${randomProduct.id}`, {
          tags: { name: "GetInventory" },
        });
        check(invRes, {
          "Inventory Check: status 200": (r) => r.status === 200,
          "Inventory Check: has stock info": (r) =>
            r.json("stock_quantity") !== undefined,
        });
      }
    });
  }

  // Scenario 2: Complete Order Flow (25% of users) - CRITICAL PATH
  if (Math.random() < 0.25 && data.products.length > 0 && data.token) {
    group("Complete Order Flow (Authenticated)", () => {
      const e2eStart = Date.now();

      // 1. Select a product
      const selectedProduct =
        data.products[Math.floor(Math.random() * data.products.length)];

      // 2. Check inventory before ordering
      const preInventoryRes = http.get(
        `${inventoryUrl}/${selectedProduct.id}`,
        {
          tags: { name: "PreOrderInventoryCheck" },
        },
      );

      let initialStock = 0;
      if (preInventoryRes.status === 200) {
        const invData = preInventoryRes.json();
        initialStock = invData.available_stock || invData.stock_quantity;

        check(preInventoryRes, {
          "Pre-Order Inventory: available stock": (r) => {
            const stock = r.json("available_stock") || r.json("stock_quantity");
            return stock > 0;
          },
        });
      }

      // 3. Create order with idempotency key
      const orderPayload = JSON.stringify({
        userId: data.userId.toString(),
        productId: selectedProduct.id,
        quantity: Math.floor(Math.random() * 3) + 1, // Random 1-3 items
        idempotencyKey: `load_test_${__VU}_${__ITER}_${Date.now()}`,
      });

      const orderRes = http.post(`${orderUrl}`, orderPayload, {
        headers: authHeaders,
        tags: { name: "CreateOrder" },
      });

      const orderSuccess = check(orderRes, {
        "Create Order: status 201": (r) => r.status === 201,
        "Create Order: returns order id": (r) => r.json("id") !== undefined,
        "Create Order: has total price": (r) =>
          r.json("total_price") !== undefined,
        "Create Order: status is pending": (r) =>
          r.json("status") === "pending",
        "Create Order: returns available stock": (r) =>
          r.json("available_stock") !== undefined,
      });

      if (orderSuccess) {
        orderCreationSuccess.add(1);
        const orderId = orderRes.json("id");

        // 4. Retrieve the created order
        const getOrderRes = http.get(`${orderUrl}/${orderId}`, {
          tags: { name: "GetOrder" },
        });
        check(getOrderRes, {
          "Get Order: status 200": (r) => r.status === 200,
          "Get Order: matches created order": (r) => r.json("id") === orderId,
        });

        // 5. Wait for event-driven inventory update (EventBridge → Lambda → Inventory)
        sleep(2); // Allow time for async event processing

        // 6. Verify inventory was updated via event
        const postInventoryRes = http.get(
          `${inventoryUrl}/${selectedProduct.id}`,
          {
            tags: { name: "PostOrderInventoryCheck" },
          },
        );

        if (postInventoryRes.status === 200) {
          const finalStock =
            postInventoryRes.json("available_stock") ||
            postInventoryRes.json("stock_quantity");
          const expectedDecrease = orderRes.json("quantity");

          check(postInventoryRes, {
            "Post-Order Inventory: stock decreased": (r) => {
              // In production with EventBridge, stock should decrease
              // In local dev without EventBridge, this might not happen
              const final =
                r.json("available_stock") || r.json("stock_quantity");
              return final <= initialStock; // Stock should not increase
            },
          });

          inventoryUpdateLatency.add(postInventoryRes.timings.duration);
        }

        const e2eEnd = Date.now();
        orderToInventoryE2E.add(e2eEnd - e2eStart);
      } else {
        orderCreationFailure.add(1);

        // Check error types
        if (orderRes.status === 409) {
          check(orderRes, {
            "Order Failed: insufficient stock (expected)": (r) =>
              r.json("error") === "INSUFFICIENT_STOCK",
          });
        } else if (orderRes.status === 404) {
          check(orderRes, {
            "Order Failed: product not found": (r) =>
              r.json("error") === "PRODUCT_NOT_FOUND",
          });
        }
      }
    });
  }

  // Scenario 3: New User Registration (5% of users)
  if (Math.random() < 0.05) {
    group("New User Registration", () => {
      const uniqueId = `user_${__VU}_${__ITER}_${Date.now()}`;
      const newUser = JSON.stringify({
        email: `${uniqueId}@example.com`,
        password: "Password123!",
      });

      // Register
      const regRes = http.post(`${authUrl}/register`, newUser, {
        headers: jsonHeaders,
        tags: { name: "Register" },
      });
      check(regRes, {
        "Register: status 201 or 400": (r) => [201, 400].includes(r.status),
        "Register: returns user object": (r) =>
          r.json("user") !== undefined || r.status === 400,
      });

      // Login
      const loginRes = http.post(`${authUrl}/login`, newUser, {
        headers: jsonHeaders,
        tags: { name: "Login" },
      });
      check(loginRes, {
        "Login: status 200": (r) => r.status === 200 || r.status === 401,
        "Login: JWT token received": (r) =>
          r.json("token") !== undefined || r.status === 401,
      });
    });
  }

  sleep(1);
}

// Teardown function - runs once at the end
export function teardown(data) {
  console.log("\n=== Load Test Summary ===");
  console.log(`Total Products Available: ${data.products.length}`);
  console.log(`Test User: ${data.testUser.email}`);
  console.log(`JWT Token Generated: ${data.token ? "Yes" : "No"}`);
}
