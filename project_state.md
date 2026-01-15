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

## Phase 3: Frontend Development [COMPLETE]

- [x] **Step 8.1:** Installed dependencies (React Router, Axios, Bootstrap).
- [x] **Step 8.2:** Implemented Auth Context & Protected Routes.
- [x] **Step 8.3:** Created Pages: Home (Catalog), Login, Register, Checkout.
- [x] **Step 8.4:** Integrated Frontend with Backend APIs (IAM, Product, Order).

## Phase 4: Infrastructure & Reliability [IN PROGRESS]

- [x] **Step 9.1:** Initialized AWS CDK project in `infrastructure/cdk`.
- [x] **Step 9.2:** Defined `CdkStack` with VPC, ECS Cluster, and Fargate Services for all 4 microservices.
- [x] **Step 9.3:** Added API Gateway (REST) routing to service Load Balancers.
- [x] **Step 9.4:** Added EventBridge EventBus and Rule for async Order -> Inventory sync.

## Immediate Next Steps (To-Do)

1.  **Event Integration in Code:** Update `order-service` to actually publish to EventBridge (currently logs) and `inventory-service` to consume.
2.  **Testing:** Add integration tests for the full flow.
3.  **Final Report:** Draft the architectural documentation based on the CDK code.
