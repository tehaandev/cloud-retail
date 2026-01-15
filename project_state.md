# Current Project Status

## Phase 1: Architecture & Design Strategy [COMPLETE]

- [x] Defined Microservices Boundaries (IAM, Product, Order, Inventory).
- [x] Selected Tech Stack (AWS, Node.js, React, Postgres, DynamoDB).
- [x] Defined API Specifications (JSON payloads drafted).
- [x] Designed Data Flow (Async Order -> Inventory sync).

## Phase 2: Backend Core Development [COMPLETE]

- [x] **Step 6.1:** Initialized `services/iam-service`.
- [x] **Step 6.2:** Created `.env` and `package.json` for IAM.
- [x] **Step 6.3:** Implemented `index.js` with Mock DB, Register, Login, and JWT generation.
- [x] **Step 6.4:** Verified "Proof of Life" via curl/Postman.
- [x] **Step 7.1:** Refactored IAM Service to use PostgreSQL.
- [x] **Step 7.2:** Initialized Product Service with DynamoDB connection.
- [x] **Step 7.3:** Initialized Order Service with Postgres and Product Service integration.
- [x] **Step 7.4:** Initialized Inventory Service with Postgres and event consumer webhook.
- [x] **Step 7.5:** Integrated all services into `docker-compose.yml` with local databases.

## Immediate Next Steps (To-Do)

1.  **API Gateway Integration:** Set up an entry point (e.g., Nginx or a simple Node.js Gateway) to route requests to appropriate services.
2.  **Event-Driven Architecture:** Implement a real message broker (e.g., LocalStack EventBridge or RabbitMQ) to replace the current mock/log events.
3.  **Frontend Development:** Connect the React frontend to the IAM Service for login/registration.
4.  **Testing Suite:** Implement integration tests using `Supertest` to verify cross-service workflows (Order -> Inventory sync).
5.  **Security Hardening:** Add JWT verification middleware to Product, Order, and Inventory services.
