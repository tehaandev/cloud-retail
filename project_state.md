# Current Project Status

## Phase 1: Architecture & Design Strategy [COMPLETE]

- [x] Defined Microservices Boundaries (IAM, Product, Order, Inventory).
- [x] Selected Tech Stack (AWS, Node.js, React, Postgres, DynamoDB).
- [x] Defined API Specifications (JSON payloads drafted).
- [x] Designed Data Flow (Async Order -> Inventory sync).

## Phase 2: Backend Core Development [IN PROGRESS]

- [x] **Step 6.1:** Initialized `services/iam-service`.
- [x] **Step 6.2:** Created `.env` and `package.json` for IAM.
- [x] **Step 6.3:** Implemented `index.js` with Mock DB, Register, Login, and JWT generation.
- [x] **Step 6.4:** Verified "Proof of Life" via curl/Postman.

## Immediate Next Steps (To-Do)

1.  **Refactor IAM Service:** Replace Mock DB with real PostgreSQL connection using `pg` pool.
2.  **Initialize Product Service:** Create `services/product-service` with DynamoDB connection.
3.  **Initialize Order Service:** Create `services/order-service`.
4.  **Docker Integration:** Create `Dockerfile` for IAM service and set up `docker-compose.yml` to run Postgres locally.
