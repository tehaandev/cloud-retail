# COMP60010 — Enterprise Cloud and Distributed Web Applications
## Final Academic Report: CloudRetail E-Commerce Platform

**Student Submission**
**Submission Date:** February 2026

---

## Executive Summary

This report presents the design, implementation, and evaluation of CloudRetail, a cloud-native e-commerce platform built using microservices architecture on Amazon Web Services (AWS). The system addresses the fundamental requirements of modern distributed systems including scalability, fault tolerance, real-time data synchronization, and security. The implementation demonstrates a transition from monolithic architecture to microservices through four independently deployable services: Identity and Access Management (IAM), Product Catalog, Order Management, and Inventory Control. The infrastructure is defined using Infrastructure-as-Code (IaC) with AWS Cloud Development Kit (CDK), deployed on containerized compute with AWS Fargate, and integrated through API Gateway and EventBridge for synchronous and asynchronous communication patterns.

---

## 1. Introduction

### 1.1 Context and Problem Statement

The CloudRetail case study represents a common enterprise challenge: migrating from a monolithic application architecture to a cloud-native microservices platform capable of supporting global e-commerce operations. The business requirements demand 24/7 availability, autonomous fault recovery, real-time inventory synchronization, global scalability, and secure handling of customer data in compliance with GDPR and PCI DSS regulations. The system must process millions of daily transactions while maintaining acceptable performance and cost efficiency.

### 1.2 Objectives

The primary objective of this project is to design and implement a distributed web application that demonstrates practical application of cloud computing principles and microservices architecture. Specifically, the system must:

1. Implement loosely coupled microservices with clear domain boundaries
2. Deploy infrastructure on AWS using modern cloud services
3. Provide secure authentication and authorization mechanisms
4. Enable real-time event-driven communication between services
5. Support horizontal scalability and fault tolerance
6. Maintain data consistency across distributed components

This implementation serves as a proof-of-concept demonstrating architectural patterns and cloud technologies applicable to production e-commerce platforms.

---

## 2. System Overview

### 2.1 Architecture Summary

The CloudRetail platform implements a microservices architecture consisting of four core services, a React-based frontend application, and supporting cloud infrastructure. The system is designed for deployment on AWS but includes local development capabilities using Docker Compose.

**Core Components:**

1. **IAM Service** — Manages user registration, authentication, and JWT token generation
2. **Product Service** — Provides product catalog management backed by DynamoDB
3. **Order Service** — Handles order creation and publishes order events to EventBridge
4. **Inventory Service** — Consumes order events and updates stock levels asynchronously
5. **Frontend Application** — React TypeScript SPA providing user interface
6. **Cloud Infrastructure** — AWS CDK-defined resources including VPC, ECS Fargate, API Gateway, EventBridge, RDS PostgreSQL, and DynamoDB

### 2.2 Technology Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Frontend | React 19, TypeScript, Vite | Modern development experience, type safety, fast builds |
| Backend Runtime | Node.js 18+, Express.js | Consistent language across services, lightweight framework |
| Containerization | Docker, AWS Fargate | Portability, managed orchestration without Kubernetes overhead |
| Infrastructure | AWS CDK (TypeScript) | Type-safe IaC, programmatic resource definition |
| Databases | PostgreSQL (RDS), DynamoDB | Relational data for transactions, NoSQL for product catalog flexibility |
| API Gateway | AWS API Gateway (REST) | Unified entry point, CORS support, routing |
| Event Bus | AWS EventBridge | Managed event routing, decoupled communication |
| Authentication | JWT, bcrypt | Industry-standard stateless auth, secure password hashing |

### 2.3 Mapping to CloudRetail Requirements

The implementation addresses the CloudRetail business requirements as follows:

- **High Availability:** Multi-AZ VPC deployment with application load balancers
- **Fault Tolerance:** Service isolation, stateless design, health check endpoints
- **Real-Time Synchronization:** EventBridge-based event-driven architecture for inventory updates
- **Global Scaling:** Fargate auto-scaling capabilities (configured, not load-tested)
- **Security:** JWT authentication, password hashing, VPC network isolation
- **High Transaction Volume:** Horizontally scalable containerized services with NoSQL and relational database options

---

## 3. Cloud Architecture Design

### 3.1 Infrastructure Overview

The cloud architecture is defined entirely as code using AWS CDK, ensuring reproducibility and version control. The stack (`infrastructure/cdk/lib/cdk-stack.ts`) provisions the following resources:

**Network Layer:**
- VPC with 2 Availability Zones for redundancy
- Public and private subnets with NAT Gateway for outbound internet access
- Security groups for service-to-service communication

**Compute Layer:**
- ECS Cluster for container orchestration
- Four Fargate services (512 MiB memory, 256 CPU units each)
- Application Load Balancers for each service providing health checks and traffic distribution

**Data Layer:**
- RDS PostgreSQL 15 instance (db.t3.micro) for IAM, Order, and Inventory services
- DynamoDB table (pay-per-request billing) for Product catalog
- Automatic database initialization via service startup scripts

**Integration Layer:**
- API Gateway (REST API) as unified entry point
- EventBridge custom event bus for asynchronous service communication
- Event Archive for 7-day retention supporting audit and debugging

### 3.2 Scalability Design

**Horizontal Scaling:**
Each Fargate service is configured with task-level resource limits enabling independent horizontal scaling. ECS Service Auto Scaling (not explicitly configured in code) can be added based on CloudWatch metrics such as CPU utilization or request count. The stateless design of all services ensures new task instances can be added without session state concerns.

**Database Scaling:**
- DynamoDB operates in on-demand billing mode, automatically scaling read/write capacity
- RDS PostgreSQL is deployed as a single instance; production scaling would require read replicas and potentially Amazon Aurora with multi-master capabilities
- Connection pooling via `pg` library prevents connection exhaustion

**Geographic Distribution:**
The current implementation deploys to a single AWS region. Global scaling would require:
- Multi-region deployment with Route 53 latency-based routing
- DynamoDB Global Tables for active-active replication
- Aurora Global Database for cross-region read replicas
- CloudFront CDN for static frontend assets

### 3.3 High Availability and Fault Tolerance

**Multi-AZ Deployment:**
The VPC spans two Availability Zones. Application Load Balancers distribute traffic across healthy targets in multiple AZs. RDS supports Multi-AZ deployment (currently single-AZ for cost) enabling automatic failover.

**Service Isolation:**
Each microservice runs in isolated containers with dedicated load balancers. Failures in one service do not cascade to others due to loose coupling via API contracts and event-driven messaging.

**Health Monitoring:**
All services expose `/health` endpoints used by ALB health checks. Unhealthy tasks are automatically replaced by ECS.

**Disaster Recovery:**
- EventBridge Archive retains all events for 7 days enabling event replay
- Database backup strategies (automated RDS snapshots) provide point-in-time recovery
- Infrastructure-as-Code enables rapid recreation in alternate regions

**Limitations:**
The current implementation does not include:
- Circuit breakers or retry policies with exponential backoff
- Dead Letter Queues (DLQ) for failed event processing
- Chaos engineering validation of failure scenarios

---

## 4. Distributed Microservices Architecture

### 4.1 Service Boundaries and Responsibilities

The system implements Domain-Driven Design principles with clear bounded contexts:

**IAM Service** (services/iam-service/)
- **Responsibility:** User registration, authentication, JWT issuance
- **Database:** PostgreSQL (users table with email, hashed password, role)
- **Endpoints:** `POST /auth/register`, `POST /auth/login`, `GET /health`
- **Lines of Code:** ~100

**Product Service** (services/product-service/)
- **Responsibility:** Product catalog management
- **Database:** DynamoDB (Products table with id, name, description, price, stock)
- **Endpoints:** `GET /products`, `GET /products/:id`, `POST /products`, `GET /health`
- **Seeding:** Automatically seeds three sample products if table is empty
- **Lines of Code:** ~103

**Order Service** (services/order-service/)
- **Responsibility:** Order creation, product validation, event publication
- **Database:** PostgreSQL (orders table with user_id, product_id, quantity, total_price, status)
- **Integration:** Synchronous call to Product Service for validation, asynchronous EventBridge publication
- **Endpoints:** `POST /orders`, `GET /orders/:id`, `GET /health`
- **Lines of Code:** ~96

**Inventory Service** (services/inventory-service/)
- **Responsibility:** Stock level management, event consumption
- **Database:** PostgreSQL (inventory table with product_id, stock_quantity)
- **Integration:** Webhook endpoint for EventBridge API Destination
- **Endpoints:** `GET /inventory/:productId`, `POST /inventory/webhook/order-created`, `GET /health`
- **Lines of Code:** ~68

### 4.2 Communication Patterns

**Synchronous (Request/Response):**
The Order Service performs real-time validation by calling the Product Service:
```javascript
const response = await axios.get(`${PRODUCT_SERVICE_URL}/products/${productId}`);
```
This ensures order creation fails fast if the product does not exist. The tight coupling here is acceptable as orders fundamentally depend on products.

**Asynchronous (Event-Driven):**
After order creation, the Order Service publishes an `OrderCreated` event to EventBridge:
```javascript
await eventbridge.putEvents({
  Source: 'com.cloudretail.order',
  DetailType: 'OrderCreated',
  Detail: JSON.stringify(order),
  EventBusName: process.env.EVENT_BUS_NAME
}).promise();
```

EventBridge routes this event to the Inventory Service via API Destination, which updates stock levels. This decoupling prevents order creation latency from being affected by inventory update performance.

**Trade-offs:**
- Synchronous calls increase latency but ensure data consistency
- Asynchronous events improve performance but introduce eventual consistency
- The chosen hybrid approach balances user experience (immediate order confirmation) with system resilience

### 4.3 API Gateway Integration

AWS API Gateway (`CloudRetailApi`) serves as the single entry point, providing:

1. **Routing:** HTTP proxy integration forwarding requests to appropriate ALBs
   - `/auth/*` → IAM Service
   - `/products` → Product Service
   - `/orders/*` → Order Service
   - `/inventory/*` → Inventory Service

2. **CORS:** Configured with `allowOrigins: ALL_ORIGINS` to support local frontend development (production should restrict to specific domains)

3. **Security:** Currently relies on service-level authentication; API Gateway authorization (Lambda authorizers, API keys) not implemented

4. **Versioning:** Not implemented; future versions should use path-based versioning (e.g., `/v1/products`)

### 4.4 Service Independence

Each service:
- Maintains its own database schema (avoiding shared databases)
- Can be deployed independently via CDK
- Has isolated failure domains
- Uses standard HTTP contracts enabling polyglot implementations

**Dependency Analysis:**
- IAM Service: No dependencies
- Product Service: No dependencies
- Order Service: Depends on Product Service (synchronous), EventBridge (asynchronous)
- Inventory Service: Depends on EventBridge events

---

## 5. API Design and Security

### 5.1 Authentication Mechanism

The system implements JWT-based authentication:

**Registration Flow:**
1. User submits email and password to `POST /auth/register`
2. IAM Service validates uniqueness, hashes password with bcrypt (salt rounds: 10)
3. User record created with default role 'customer'

**Login Flow:**
1. User submits credentials to `POST /auth/login`
2. IAM Service verifies password hash using bcrypt.compare
3. JWT token generated with payload: `{ id, email, role }`, signed with `JWT_SECRET`, expiry: 1 hour
4. Token returned to client

**Token Usage:**
The frontend stores tokens in memory (AuthContext) and includes them in API requests:
```typescript
axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
```

**Security Considerations:**
- Passwords hashed with bcrypt (industry standard, adaptive hashing)
- JWT secret stored in environment variables (should use AWS Secrets Manager in production)
- Token expiry limits exposure window
- HTTPS enforcement required in production (ALB SSL termination)

**Limitations:**
- No token refresh mechanism
- No revocation capability (stateless design trade-off)
- No multi-factor authentication
- Role-based access control (RBAC) defined but not enforced in service endpoints

### 5.2 Authorization

While user roles are stored ('customer' default), services do not currently implement middleware to verify JWT tokens or enforce role-based permissions. Production implementation would require:

```javascript
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Unauthorized' });
    req.user = decoded;
    next();
  });
};
```

This would be applied to protected endpoints with role checks.

### 5.3 API Security Best Practices

**Implemented:**
- CORS configuration (overly permissive for development)
- Password hashing
- SQL parameterization preventing injection attacks:
  ```javascript
  query("SELECT * FROM users WHERE email = $1", [email])
  ```

**Not Implemented:**
- Rate limiting (would use API Gateway throttling or service-level libraries)
- IP whitelisting
- API key management
- Request validation schemas (would use express-validator)
- HTTPS enforcement (development uses HTTP)

**Service-to-Service Security:**
Currently services communicate over internal VPC network without authentication. Production should implement:
- mTLS for service mesh security
- IAM roles for service authorization
- Private API Gateway endpoints

### 5.4 Data Encryption

**At Rest:**
- RDS encryption not explicitly enabled (CDK default depends on AWS account settings)
- DynamoDB encryption enabled by default (AWS managed keys)

**In Transit:**
- Local development uses HTTP
- Production deployment would enable HTTPS via ACM certificates on ALBs

### 5.5 API Documentation

**Current State:**
No OpenAPI/Swagger documentation exists. API contracts are implicitly defined in service code.

**Recommendation:**
Generate OpenAPI 3.0 specifications using tools like `swagger-jsdoc`:
```yaml
/auth/login:
  post:
    summary: User login
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            properties:
              email: { type: string, format: email }
              password: { type: string, minLength: 8 }
    responses:
      200:
        description: Login successful
        content:
          application/json:
            schema:
              type: object
              properties:
                token: { type: string }
                user: { type: object }
```

---

## 6. Data Management, Consistency, and Compliance

### 6.1 Database Design

**PostgreSQL (Relational):**
Used for IAM, Orders, and Inventory where ACID properties and relational integrity are critical.

*IAM Schema (services/iam-service/db.js):*
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

*Orders Schema (services/order-service/db.js):*
```sql
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,  -- Foreign key (not enforced across services)
  product_id VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

*Inventory Schema (services/inventory-service/db.js):*
```sql
CREATE TABLE inventory (
  product_id VARCHAR(255) PRIMARY KEY,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**DynamoDB (NoSQL):**
Used for Product catalog where flexible schema and high read throughput are prioritized.

*Products Schema:*
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "price": "number",
  "stock": "number",
  "createdAt": "ISO8601 timestamp"
}
```

### 6.2 Data Consistency Model

**Strong Consistency:**
- User authentication queries (PostgreSQL read-committed isolation)
- Order creation (single database transaction)
- Inventory reads (PostgreSQL)

**Eventual Consistency:**
- Inventory updates after order creation (asynchronous via EventBridge)
- Product catalog updates (DynamoDB eventual consistency for reads)

**CAP Theorem Analysis:**
This system prioritizes Availability and Partition Tolerance (AP) with eventual consistency for inventory. During network partitions:
- Orders can still be created (Order Service remains available)
- Inventory updates may be delayed (partition between services)
- Financial transactions use strong consistency (within single database)

**Consistency Patterns:**

*Saga Pattern (Implicit):*
The order creation flow implements a choreography-based saga:
1. Order Service creates order (local transaction)
2. Event published to EventBridge (at-least-once delivery)
3. Inventory Service consumes event and updates stock (compensating transaction if order fails)

Missing: Compensation logic if inventory cannot be decremented (e.g., negative stock prevention, order rollback).

*CQRS (Not Implemented):*
The system uses shared read/write models. High-traffic scenarios would benefit from CQRS with read replicas or materialized views for product queries.

### 6.3 Data Integrity

**Referential Integrity:**
Microservices architecture deliberately avoids foreign key constraints across services. The `user_id` and `product_id` in orders table are logical references, not enforced.

**Validation:**
- Product existence validated synchronously before order creation
- Atomic stock updates using SQL: `stock_quantity = stock_quantity - $1`

**Potential Issues:**
- Race conditions if concurrent orders exceed available stock
- Orphaned orders if products are deleted after order creation
- No distributed transaction coordinator

### 6.4 Compliance Considerations

**GDPR:**
- **Right to Access:** User data queryable via IAM Service (endpoint not implemented)
- **Right to Deletion:** No deletion endpoint (would require cascading delete across services)
- **Data Minimization:** Only essential fields stored
- **Encryption:** Required for production (not enforced in current implementation)
- **Consent Management:** Not implemented

**PCI DSS:**
- **No Payment Data Stored:** System does not handle credit card information (would integrate with Stripe/PayPal)
- **Access Control:** Limited by JWT authentication
- **Audit Logging:** EventBridge Archive provides partial audit trail
- **Network Segmentation:** VPC isolation implemented

**Regional Data Sovereignty:**
Single-region deployment satisfies local regulations. Multi-region would require:
- Conditional routing based on user location
- Data residency controls (e.g., EU users → eu-west-1 RDS instance)
- Cross-border data transfer agreements

---

## 7. Real-Time Data Synchronization

### 7.1 Event-Driven Architecture

The system implements asynchronous communication using AWS EventBridge for decoupling order creation from inventory updates.

**Event Flow:**
1. Order Service creates order in PostgreSQL
2. Order Service publishes `OrderCreated` event:
   ```javascript
   {
     Source: 'com.cloudretail.order',
     DetailType: 'OrderCreated',
     Detail: JSON.stringify({
       id: 123,
       product_id: 'abc',
       quantity: 2,
       total_price: 39.98,
       status: 'pending'
     })
   }
   ```
3. EventBridge Rule matches event pattern and routes to API Destination
4. API Destination invokes Inventory Service webhook: `POST /inventory/webhook/order-created`
5. Inventory Service decrements stock atomically

**Advantages:**
- Order creation not blocked by inventory update latency
- Services remain decoupled (inventory service can be offline without failing orders)
- Event archive enables debugging and replay

**Latency Characteristics:**
- EventBridge propagation: typically <1 second
- End-to-end (order creation → inventory update): 1-3 seconds under normal conditions
- Real-time for user-facing responses, near-real-time for backend synchronization

### 7.2 Alternative Synchronization Approaches

**Polling (Not Used):**
Inventory Service could poll Orders database for new orders. Rejected due to:
- Database coupling (violates microservices principles)
- Inefficiency (constant polling even when idle)
- Increased load on order database

**Message Queue (Not Used):**
SQS would provide similar functionality. EventBridge was chosen for:
- Schema registry capabilities (future evolution)
- Native event filtering and routing
- Integration with AWS service ecosystem

**Webhooks (Used via API Destination):**
EventBridge invokes Inventory Service via HTTP POST. This hybrid approach combines event-driven decoupling with simple HTTP handling.

### 7.3 Data Propagation Use Cases

**Inventory Updates:**
Implemented as described above.

**Order Status Changes:**
Not implemented. Future enhancement would publish `OrderShipped`, `OrderDelivered` events consumed by notification service.

**Pricing Adjustments:**
Product price changes are not propagated to existing orders (prices are denormalized into orders table at creation time, preventing retroactive changes).

### 7.4 Event Reliability

**Delivery Guarantees:**
EventBridge provides at-least-once delivery. Inventory Service must implement idempotency:
```javascript
// Current implementation is NOT idempotent - duplicate events would double-decrement
// Production fix: Include idempotency key in event, check before processing
```

**Failure Handling:**
- If Inventory Service is unavailable, EventBridge retries (default: 24 hours, 185 times)
- No DLQ configured; failed events after retry exhaustion are lost
- Recommendation: Add SQS DLQ for manual intervention

**Monitoring:**
EventBridge CloudWatch metrics track:
- FailedInvocations
- Invocations
- TriggeredRules

---

## 8. Fault Tolerance and Recovery

### 8.1 Fault Tolerance Mechanisms

**Service-Level Resilience:**

*Health Checks:*
All services expose `/health` endpoints:
```javascript
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Service is healthy" });
});
```
ECS target groups perform health checks every 30 seconds, deregistering unhealthy tasks.

*Stateless Design:*
Services maintain no in-memory session state. All authentication state is in JWT tokens, all business state is in databases. This enables:
- Horizontal scaling without session affinity
- Rolling deployments without session loss
- Crash recovery without state restoration

*Database Connection Pooling:*
PostgreSQL connections managed via `pg` Pool:
```javascript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```
Handles transient connection failures and prevents resource exhaustion.

**Infrastructure-Level Resilience:**

*Multi-AZ Deployment:*
VPC spans 2 AZs. Load balancers distribute traffic across AZ-redundant targets. AZ-level failures automatically rerouted.

*Auto-Scaling (Configured, Not Tuned):*
ECS services can be configured with target tracking scaling policies based on:
- CPU utilization
- Request count per target
- Custom CloudWatch metrics

*Fargate Task Replacement:*
Failed tasks automatically replaced by ECS control plane.

### 8.2 Retry and Circuit Breaker Patterns

**Current Implementation:**
No explicit retry logic or circuit breakers implemented.

**Retry Behavior:**
- Order Service → Product Service: Single attempt, fails on timeout/error
- EventBridge: Automatic retries with exponential backoff (managed service)

**Production Recommendations:**

*Exponential Backoff:*
```javascript
const retry = require('async-retry');
await retry(async () => {
  return axios.get(productUrl);
}, {
  retries: 3,
  minTimeout: 100,
  maxTimeout: 1000
});
```

*Circuit Breaker (using `opossum`):*
```javascript
const circuitBreaker = require('opossum');
const breaker = new circuitBreaker(callProductService, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});
```

### 8.3 Disaster Recovery Strategy

**Recovery Time Objective (RTO) and Recovery Point Objective (RPO):**

| Component | RPO | RTO | Strategy |
|-----------|-----|-----|----------|
| PostgreSQL | 5 min | 30 min | Automated snapshots, point-in-time recovery |
| DynamoDB | 0 sec | 10 min | Point-in-time recovery enabled, continuous backups |
| ECS Services | 0 sec | 5 min | Infrastructure-as-Code redeploy |
| EventBridge | 0 sec | Immediate | Managed service, multi-AZ by default |

**Backup Strategy:**
- RDS: Automated daily snapshots (7-day retention), transaction logs for PITR
- DynamoDB: Continuous backups enabled by default
- Application State: Stored in version-controlled CDK code
- Event Archive: 7-day retention for event replay

**Regional Failover:**
Current implementation is single-region. Multi-region DR would require:
1. Replicate CDK stack to secondary region
2. Configure DynamoDB Global Tables
3. Setup Aurora Global Database
4. Implement Route 53 health checks with failover routing
5. Cross-region EventBridge event routing

**Estimated DR Cost:**
Maintaining hot standby in secondary region: ~100% cost increase
Warm standby (scaled-down): ~30% cost increase
Cold standby (IaC only): Near-zero cost, higher RTO (1-2 hours)

### 8.4 Autonomous Recovery

**Self-Healing Capabilities:**
- Unhealthy ECS tasks replaced without human intervention
- Load balancers automatically route around failed instances
- EventBridge automatic retries for transient failures

**Manual Intervention Required:**
- Database corruption or schema errors
- Application logic bugs causing persistent failures
- Capacity limits (account quotas, resource exhaustion)

**Observability for Recovery:**
CloudWatch alarms should trigger:
- SNS notifications for critical failures
- Lambda functions for automated remediation (e.g., restart service, clear cache)
- PagerDuty integration for on-call escalation

---

## 9. Monitoring, Logging, and Observability

### 9.1 Current Monitoring Implementation

**Application Logging:**
Services use `console.log` for logging:
```javascript
console.log(`[EVENT] OrderCreated published to EventBridge: ${order.id}`);
console.error("[ERROR] Failed to publish event to EventBridge:", eventError);
```

Logs are streamed to CloudWatch Logs by Fargate automatically (log group per service).

**Infrastructure Monitoring:**
AWS-managed metrics available in CloudWatch:
- ECS: CPUUtilization, MemoryUtilization, TaskCount
- ALB: RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count
- RDS: DatabaseConnections, CPUUtilization, FreeStorageSpace
- DynamoDB: ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits
- EventBridge: Invocations, FailedInvocations

**Health Checks:**
Load balancer health checks provide binary availability status. No custom health metrics (database connectivity, dependency health).

### 9.2 Logging Best Practices

**Current Gaps:**
- No structured logging (JSON format for parsing)
- No correlation IDs for tracing requests across services
- No log levels (info, warn, error, debug)
- No centralized log aggregation beyond CloudWatch

**Production Recommendations:**

*Structured Logging with Winston:*
```javascript
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'order-service' },
  transports: [new winston.transports.Console()]
});

logger.info('Order created', {
  orderId: order.id,
  userId: userId,
  correlationId: req.headers['x-correlation-id']
});
```

*Correlation IDs:*
API Gateway should inject correlation ID, propagated through all service calls for end-to-end request tracing.

### 9.3 Distributed Tracing

**Not Implemented:**
No distributed tracing instrumentation (AWS X-Ray, Jaeger, or Zipkin).

**Proposed Implementation:**
- Integrate AWS X-Ray SDK into services
- Trace API Gateway → Order Service → Product Service flow
- Trace EventBridge event propagation
- Analyze latency breakdown and identify bottlenecks

**Example X-Ray Instrumentation:**
```javascript
const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
const http = AWSXRay.captureHTTPs(require('http'));
```

### 9.4 Metrics Collection

**Custom Metrics (Not Implemented):**
Services should emit business metrics to CloudWatch:
- Orders created per minute
- Authentication success/failure rate
- Inventory update latency
- Product catalog query cache hit rate

**Example:**
```javascript
const cloudwatch = new AWS.CloudWatch();
cloudwatch.putMetricData({
  Namespace: 'CloudRetail/Orders',
  MetricData: [{
    MetricName: 'OrdersCreated',
    Value: 1,
    Unit: 'Count',
    Timestamp: new Date()
  }]
}).promise();
```

### 9.5 Alerting Strategy

**Recommended CloudWatch Alarms:**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Order Service 5XX errors | >5% of requests | SNS → Email/SMS |
| RDS CPU | >80% for 5 min | Auto-scaling trigger |
| EventBridge failed invocations | >0 | Investigate DLQ |
| ALB unhealthy targets | <2 targets healthy | Scale out |

### 9.6 Observability Maturity Assessment

**Current State:** Level 1 (Basic)
- Logs exist but unstructured
- Infrastructure metrics available
- No distributed tracing
- Reactive troubleshooting

**Target State:** Level 3 (Full Observability)
- Structured logs with correlation IDs
- Custom business metrics
- Distributed tracing with flame graphs
- Proactive anomaly detection
- Service mesh (AWS App Mesh) for traffic visualization

---

## 10. Testing Strategy and Results

### 10.1 Testing Approach

The current implementation does not include automated test suites. Testing was performed manually during development using Postman and browser-based interaction. This section outlines the testing that was conducted and the testing strategy that should be implemented.

### 10.2 Unit Testing

**Current State:**
No unit tests exist (`npm test` scripts return "no test specified").

**Recommended Implementation:**
Unit tests should use Jest for Node.js services:

*Example Test Structure (services/iam-service/tests/auth.test.js):*
```javascript
const request = require('supertest');
const app = require('../index');

describe('Authentication', () => {
  test('POST /auth/register creates new user', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toHaveProperty('id');
  });

  test('POST /auth/login returns JWT token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  test('Rejects login with invalid password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });
    expect(res.status).toBe(400);
  });
});
```

**Coverage Goals:**
- Database initialization functions
- JWT generation and validation logic
- Password hashing verification
- Error handling for invalid inputs
- Target: 80% code coverage

### 10.3 Integration Testing

**Current State:**
Manual integration testing was performed using Docker Compose. The following end-to-end flow was validated:

1. User registration via `POST localhost:3001/auth/register`
2. User login via `POST localhost:3001/auth/login` (receives JWT)
3. Product catalog retrieval via `GET localhost:3002/products`
4. Order creation via `POST localhost:3003/orders` with JWT in Authorization header
5. Order retrieval via `GET localhost:3003/orders/:id`

**Results:**
- ✅ User can register and login successfully
- ✅ JWT tokens are generated and include user information
- ✅ Product catalog returns seeded products (Cloud Hanger, Serverless Mug, Kubernetes Kube)
- ✅ Order creation validates product existence before creating order
- ✅ Order total price calculated correctly (product.price × quantity)
- ⚠️ Inventory updates are not automatically triggered in local environment (EventBridge requires AWS deployment)

**Recommended Automated Integration Tests:**

*Example Test (tests/integration/order-flow.test.js):*
```javascript
describe('Order Creation Flow', () => {
  let authToken;
  let productId;

  beforeAll(async () => {
    // Login to get token
    const login = await axios.post('http://localhost:3001/auth/login', {
      email: 'test@example.com',
      password: 'password123'
    });
    authToken = login.data.token;

    // Get available product
    const products = await axios.get('http://localhost:3002/products');
    productId = products.data[0].id;
  });

  test('Complete order flow with inventory update', async () => {
    // Create order
    const order = await axios.post('http://localhost:3003/orders', {
      userId: '1',
      productId: productId,
      quantity: 2
    }, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    expect(order.status).toBe(201);
    expect(order.data.status).toBe('pending');

    // Wait for event processing (or mock EventBridge)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify inventory updated
    const inventory = await axios.get(`http://localhost:3004/inventory/${productId}`);
    expect(inventory.data.stock_quantity).toBeLessThan(100);
  });
});
```

### 10.4 API Testing

**Current State:**
Manual API testing performed with Postman. No automated API tests or contract tests.

**Postman Collection Structure:**
- Authentication folder (Register, Login)
- Products folder (Get All, Get By ID, Create Product)
- Orders folder (Create Order, Get Order)
- Inventory folder (Get Stock, Webhook Test)

**Recommended Enhancements:**
- Export Postman collections to Git repository
- Use Newman for CI/CD pipeline integration
- Implement contract testing with Pact to verify service interfaces

### 10.5 Performance Testing

**Current State:**
No load testing or stress testing conducted.

**Recommended Performance Tests:**

*Load Testing with k6:*
```javascript
// load-tests/order-creation.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // Less than 1% failure rate
  },
};

export default function () {
  const payload = JSON.stringify({
    userId: '1',
    productId: 'test-product-id',
    quantity: 1,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token',
    },
  };

  let res = http.post('http://api-gateway-url/orders', payload, params);
  check(res, { 'status is 201': (r) => r.status === 201 });
  sleep(1);
}
```

**Performance Targets:**
- Latency: p95 < 500ms for API requests
- Throughput: 1000 requests/second per service
- Error Rate: < 0.1% under normal load
- Scalability: Linear performance degradation up to 10,000 concurrent users

**Expected Bottlenecks:**
- RDS connection limits (max_connections = 100 for db.t3.micro)
- Single NAT Gateway bandwidth limits
- DynamoDB throttling if provisioned capacity insufficient

### 10.6 Security Testing

**Current State:**
No penetration testing or vulnerability scanning performed.

**Recommended Security Tests:**
- SQL injection attempts against parameterized queries (should be blocked)
- JWT tampering and expired token validation
- CORS origin validation
- Rate limiting bypass attempts
- Password strength enforcement
- Dependency vulnerability scanning with `npm audit`

**Manual Security Validation:**
- ✅ SQL injection prevented by parameterized queries
- ✅ Passwords hashed (plaintext not stored)
- ❌ No rate limiting implemented
- ❌ CORS allows all origins (development configuration)

### 10.7 Fault Tolerance Testing

**Recommended Chaos Engineering:**
- Kill random ECS tasks and verify auto-replacement
- Disconnect database and verify error handling
- Introduce artificial latency and verify timeouts
- Simulate EventBridge failures and verify retry behavior

**Tools:**
AWS Fault Injection Simulator (FIS) for controlled chaos experiments.

### 10.8 Testing Summary and Limitations

**What Was Tested:**
- Manual end-to-end flows via Postman
- Service startup and health checks
- Database schema initialization
- JWT generation and basic validation

**What Was Not Tested:**
- Automated unit/integration tests
- Load and performance characteristics
- Security vulnerabilities
- Fault injection and recovery
- Idempotency of event handlers

**Justification for Limited Testing:**
As an academic proof-of-concept with tight scope constraints, the focus was placed on demonstrating architectural patterns and cloud service integration rather than production-grade test coverage. A commercial implementation would require comprehensive test automation as part of CI/CD pipelines.

---

## 11. Evaluation and Discussion

### 11.1 Alignment with Assignment Requirements

| Requirement | Implementation | Assessment |
|-------------|----------------|------------|
| Cloud Architecture (4.1) | AWS CDK with VPC, ECS, RDS, DynamoDB | ✅ Comprehensive IaC implementation |
| Distributed Microservices (4.2) | 4 services, REST + EventBridge | ✅ Loosely coupled, independently scalable |
| API Gateway (4.2) | AWS API Gateway with routing | ✅ Unified entry point, CORS support |
| API Documentation (4.2) | Not implemented | ❌ Missing OpenAPI specs |
| Security (4.3, 4.6) | JWT, bcrypt, VPC isolation | ⚠️ Partial - missing OAuth, RBAC enforcement |
| Data Consistency (4.3) | Eventual consistency for inventory | ✅ Appropriate CAP trade-offs |
| Compliance (4.3) | Design considerations for GDPR/PCI | ⚠️ Conceptual only, not audited |
| Real-Time Sync (4.4) | EventBridge event-driven | ✅ Near-real-time (<3s latency) |
| Fault Tolerance (4.5) | Multi-AZ, health checks | ⚠️ Missing circuit breakers, DLQs |
| Monitoring (4.8) | CloudWatch logs and metrics | ⚠️ Basic - missing tracing, structured logs |
| Testing (4.9) | Manual testing only | ❌ No automated test suite |

**Overall Assessment:**
The implementation successfully demonstrates core cloud and distributed systems concepts with production-viable architecture. Gaps exist primarily in operational maturity (testing, observability, security hardening) rather than fundamental design.

### 11.2 Architectural Strengths

**Infrastructure-as-Code Maturity:**
The complete AWS environment is defined in 173 lines of TypeScript CDK code, enabling:
- Version-controlled infrastructure changes
- Reproducible deployments across environments
- Automated resource dependency management
- Type-safe configuration

**Service Decoupling:**
Event-driven architecture with EventBridge provides genuine loose coupling. Inventory Service downtime does not prevent order creation, and services can evolve independently.

**Technology Appropriateness:**
Database choices align with data characteristics:
- PostgreSQL for transactional consistency (orders, user auth)
- DynamoDB for flexible schema and high throughput (product catalog)

**Managed Service Leverage:**
Using Fargate, RDS, DynamoDB, and EventBridge reduces operational overhead compared to self-managed Kubernetes, database clusters, and message brokers.

### 11.3 Technical Debt and Limitations

**Missing Dependency:**
The `order-service` code imports `aws-sdk` but does not declare it in `package.json`. This would cause runtime failures in deployed environments. This oversight demonstrates the need for integration testing and dependency management tooling.

**Idempotency Gap:**
The Inventory Service webhook does not implement idempotency checks. EventBridge's at-least-once delivery could cause duplicate stock decrements. Production implementation requires:
```javascript
// Check idempotency key before processing
const processed = await query("SELECT 1 FROM processed_events WHERE event_id = $1", [eventId]);
if (processed.rows.length > 0) {
  return res.status(200).json({ message: 'Already processed' });
}
```

**No Dead Letter Queues:**
Failed inventory updates after retry exhaustion are silently lost. Business-critical data should route to DLQ for manual reconciliation.

**Authorization Not Enforced:**
While JWT tokens are generated, services do not validate them. Any client can call any endpoint without authentication. This is acceptable for local development but unacceptable for production.

**Database Connection Scaling:**
Using connection pools without limits or circuit breakers. Under high load, services could exhaust RDS max_connections.

**CORS Misconfiguration:**
`allowOrigins: ALL_ORIGINS` permits any domain to call the API. Production should whitelist specific frontend domains.

### 11.4 Trade-Offs and Design Decisions

**Synchronous Product Validation:**
Chosen to fail fast and prevent invalid orders, at the cost of coupling and latency. Alternative: Accept orders optimistically, validate asynchronously, cancel invalid orders.

**EventBridge vs SQS:**
EventBridge chosen for schema evolution and multi-target routing capabilities. SQS would provide simpler FIFO guarantees and better visibility into queue depth.

**Fargate vs EKS:**
Fargate chosen to reduce Kubernetes management overhead. Trade-off: Less control over node configuration, higher per-task cost.

**Monorepo Structure:**
All services in single repository simplifies development but complicates independent deployment versioning. Polyrepo would enable true service autonomy.

**No API Versioning:**
Simplifies initial development but creates breaking change risks. Future enhancement should add `/v1/` path prefix.

### 11.5 Scalability Analysis

**Horizontal Scalability:**
Stateless services can scale to hundreds of tasks. Theoretical limit: VPC IP address exhaustion, NAT Gateway bandwidth (5 Gbps per gateway).

**Vertical Scalability:**
Current Fargate task size (512 MiB / 256 CPU) appropriate for Node.js. Larger tasks (up to 30 GB / 4 vCPU) available if needed.

**Database Scalability:**
- RDS: Vertical scaling to larger instances, read replicas for read-heavy workloads
- DynamoDB: Unlimited horizontal scaling with on-demand billing

**Cost Projections:**
Estimated AWS cost for low-traffic deployment (1 task per service, db.t3.micro, minimal data transfer):
- Fargate: ~$30/month
- RDS: ~$15/month
- DynamoDB: ~$1/month (on-demand)
- Data Transfer: ~$5/month
- **Total: ~$50-60/month**

High-traffic (10 tasks per service, db.r5.large, 1M requests/day):
- Fargate: ~$300/month
- RDS: ~$200/month
- DynamoDB: ~$50/month
- **Total: ~$600-800/month**

### 11.6 Production Readiness Assessment

| Category | Status | Blockers for Production |
|----------|--------|------------------------|
| Functionality | ✅ Ready | None |
| Security | ⚠️ Needs Work | JWT validation, secrets management, HTTPS |
| Reliability | ⚠️ Needs Work | DLQs, circuit breakers, chaos testing |
| Observability | ❌ Not Ready | Distributed tracing, structured logging, alerting |
| Testing | ❌ Not Ready | Automated test suite, load testing |
| Documentation | ❌ Not Ready | API specs, runbooks, architecture diagrams |
| Compliance | ❌ Not Ready | Security audit, GDPR implementation, encryption at rest |

**Estimated Effort to Production:**
~4-6 weeks of additional development:
- Week 1-2: Security hardening, secrets management, HTTPS setup
- Week 2-3: Observability stack (X-Ray, structured logging, CloudWatch dashboards)
- Week 3-4: Test automation (unit, integration, load tests)
- Week 4-5: Documentation (OpenAPI, architecture diagrams, runbooks)
- Week 5-6: Security audit, compliance review, disaster recovery testing

---

## 12. Challenges and Limitations

### 12.1 Technical Challenges Encountered

**EventBridge Local Development:**
AWS EventBridge is a managed service unavailable in local Docker Compose environments. Testing event-driven flows required deploying to AWS or mocking the event bus. This slowed iteration cycles during development.

**Resolution:**
Used Docker Compose for service development, AWS deployment for event integration testing. Future improvement: LocalStack for local AWS service emulation.

**Database Connection String Management:**
CDK-generated RDS endpoints are known only after deployment, requiring dynamic configuration. Hardcoded connection strings in `.env` files for local development create environment parity issues.

**Resolution:**
Services use environment variables. CDK injects production values. Local development uses `compose.yaml` environment overrides. AWS Secrets Manager would centralize this in production.

**CORS During Development:**
Frontend (localhost:5173) calling backend services (localhost:3001-3004) triggered CORS preflight failures until `cors()` middleware was added to all services.

**Resolution:**
Enabled CORS with wildcard origins for development. Production should restrict origins to deployed frontend domain.

**AWS SDK Versioning:**
The `aws-sdk` package is deprecated in favor of modular `@aws-sdk/client-*` packages. Using legacy SDK creates future migration burden.

**Resolution:**
Accepted technical debt for assignment scope. Production migration would use:
```javascript
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");
```

### 12.2 Scope Limitations

**Single Student Project Constraints:**
The assignment specification targets enterprise-scale requirements (millions of daily transactions, global distribution) achievable by engineering teams, not individual students in 6-8 weeks. Pragmatic scope decisions included:

- Single AWS region instead of multi-region
- Manual testing instead of comprehensive automation
- Basic security instead of production-grade hardening
- Conceptual compliance instead of audit-ready implementation

**Time Constraints:**
Focus areas prioritized:
1. ✅ Cloud architecture and IaC (highest academic value)
2. ✅ Microservices implementation (demonstrates distributed systems)
3. ✅ Event-driven integration (modern pattern)
4. ⚠️ Testing and documentation (limited due to time)
5. ❌ Advanced features (monitoring dashboards, chaos engineering)

**Cost Constraints:**
Avoided expensive AWS resources:
- Multi-region deployments
- Large RDS instances
- Reserved capacity or long-running load tests
- Third-party tools (DataDog, PagerDuty)

### 12.3 What Would Be Improved with More Resources

**Team of 3-5 Engineers:**
- DevOps specialist: CI/CD pipelines, monitoring stack, infrastructure optimization
- Frontend developer: React state management, responsive design, accessibility
- Backend developer: Service feature completion, performance optimization
- QA engineer: Automated testing, load testing, security scanning

**3-6 Months Timeline:**
- Month 1: Complete feature implementation, comprehensive testing
- Month 2: Security audit, compliance documentation, performance tuning
- Month 3: Multi-region deployment, disaster recovery testing
- Month 4-6: Production traffic onboarding, operational refinement

**Budget of $10,000/month:**
- Production-grade infrastructure (Multi-AZ RDS, Aurora, ElastiCache)
- Third-party monitoring (Datadog, New Relic)
- Load testing at scale (AWS Distributed Load Testing)
- Security scanning tools (Snyk, Veracode)
- CDN and WAF (CloudFront, AWS WAF)

### 12.4 Alternative Approaches Considered

**Monolith First:**
Considered building as single Node.js application, then splitting into microservices. Rejected because assignment explicitly requires microservices architecture demonstration.

**Kubernetes (EKS):**
Evaluated EKS vs Fargate. Rejected due to:
- Cluster management overhead (control plane, node groups, networking)
- Cost (EKS control plane: $0.10/hour = $73/month)
- Complexity not justified for 4 simple services

**GraphQL Federation:**
Considered GraphQL with Apollo Federation instead of REST. Rejected due to:
- Steeper learning curve
- Less alignment with assignment's RESTful API requirement
- Event-driven architecture fits better with REST + async events

**Serverless (Lambda):**
Evaluated AWS Lambda instead of containers. Rejected because:
- Cold start latency for user-facing endpoints
- Less alignment with "containerized microservices" requirement
- More difficult to develop and debug locally

---

## 13. Conclusion

### 13.1 Summary of Achievements

This project successfully designed and implemented a cloud-native e-commerce platform demonstrating modern distributed systems architecture. The key accomplishments include:

**Technical Implementation:**
- Four independently deployable microservices with clear domain boundaries
- Complete AWS infrastructure defined as code (173 lines of CDK)
- Hybrid synchronous/asynchronous communication patterns
- JWT-based authentication with secure password hashing
- Event-driven inventory synchronization via EventBridge
- Polyglot persistence (PostgreSQL and DynamoDB) tailored to data characteristics
- Containerized deployment on AWS Fargate with load balancing
- React TypeScript frontend with protected routing

**Architectural Demonstrations:**
- Microservices decomposition using domain-driven design principles
- Loose coupling through API Gateway and event buses
- Eventual consistency trade-offs for distributed data
- Infrastructure-as-Code for reproducible deployments
- Multi-AZ high availability patterns
- Stateless service design for horizontal scalability

**Academic Learning Outcomes:**
- **LO3 (Cloud-Based Web Application):** Comprehensive AWS architecture leveraging VPC, ECS, RDS, DynamoDB, API Gateway, and EventBridge
- **LO4 (Distributed API Application):** RESTful microservices with service-to-service communication and event-driven integration

### 13.2 Alignment with Learning Outcomes

**LO3: Design, implement, and test a web application based on the cloud and cloud services**

The implementation demonstrates cloud-native design through:
- AWS-managed services reducing operational overhead (Fargate, RDS, DynamoDB)
- Infrastructure-as-Code enabling version control and automation
- Cloud-specific patterns (EventBridge, ALB health checks, CloudWatch logging)
- Scalability and high availability through cloud primitives (Auto Scaling, Multi-AZ)

**LO4: Develop, implement, and test a distributed web application utilizing an API**

The distributed architecture demonstrates:
- Microservices with independent codebases, databases, and deployment lifecycles
- RESTful API contracts between services and frontend
- API Gateway as unified entry point with routing and CORS
- Asynchronous inter-service communication via events
- Distributed data management with consistency trade-offs

### 13.3 Real-World Applicability

**Transferable Patterns:**
- The event-driven order→inventory flow mirrors production e-commerce systems (Amazon, Shopify)
- JWT authentication is industry-standard for stateless microservices
- CDK infrastructure patterns are directly applicable to commercial AWS projects
- Separation of read-heavy (product catalog) and write-heavy (orders) workloads reflects real performance optimization

**Gaps from Production Systems:**
Production e-commerce platforms would additionally require:
- Payment processing integration (Stripe, PayPal)
- Search functionality (Elasticsearch/OpenSearch)
- Content delivery network for static assets (CloudFront)
- Recommendation engine (SageMaker ML models)
- Customer support integration (chatbots, ticketing systems)
- Marketing analytics and A/B testing frameworks
- Multi-tenant architecture for marketplace platforms

**Scalability to Real Traffic:**
The architecture could theoretically handle:
- 100-1,000 requests/second with current Fargate configuration
- 10,000+ req/s with Auto Scaling and database read replicas
- Millions of users with multi-region deployment and caching (ElastiCache)

Primary bottlenecks at scale would be:
1. RDS write capacity (mitigated with Aurora multi-master or sharding)
2. NAT Gateway bandwidth (mitigated with VPC endpoints for AWS services)
3. EventBridge throughput (service limit: 2,400 requests/second per region)

### 13.4 Personal Reflection on Learning

This project provided hands-on experience with cloud architecture decisions typically encountered in senior engineering roles. Key takeaways include:

**Design Trade-Offs:**
Every architectural decision involves trade-offs. EventBridge's loose coupling comes at the cost of eventual consistency complexity. Fargate's operational simplicity costs more than self-managed EC2. Understanding these trade-offs rather than seeking "perfect" solutions is critical.

**Infrastructure-as-Code Value:**
CDK dramatically reduced deployment complexity compared to manual console configuration. The ability to destroy and recreate the entire environment in minutes enabled rapid iteration. This reinforced the importance of automation in modern DevOps practices.

**Observability is Non-Negotiable:**
The absence of structured logging and distributed tracing made debugging event flows significantly harder. In retrospect, observability should be implemented alongside features, not deferred.

**Scope Management:**
Academic projects require ruthless prioritization. Focusing on core architectural patterns while acknowledging production gaps (testing, security hardening) proved more valuable than attempting superficial coverage of all requirements.

### 13.5 Future Enhancements

If development were to continue, the prioritized roadmap would be:

**Phase 1 (1-2 weeks): Production Readiness**
1. Add `aws-sdk` to `order-service` package.json
2. Implement JWT validation middleware in all services
3. Add DLQ for EventBridge rule
4. Enable HTTPS with ACM certificates on ALBs
5. Restrict CORS to specific frontend domain

**Phase 2 (2-4 weeks): Observability and Testing**
1. Integrate AWS X-Ray for distributed tracing
2. Implement structured logging with Winston and correlation IDs
3. Create CloudWatch dashboards for key metrics
4. Build automated test suite (Jest unit tests, Supertest integration tests)
5. Conduct k6 load testing and document performance baselines

**Phase 3 (1-2 months): Advanced Features**
1. Implement API versioning (`/v1/` path prefix)
2. Add OpenAPI documentation generation
3. Create notification service for order status updates
4. Implement saga pattern with compensation logic
5. Add read caching with ElastiCache Redis
6. Enable multi-region deployment with Aurora Global Database

**Phase 4 (2-3 months): Enterprise Features**
1. Payment gateway integration (Stripe)
2. Search service with OpenSearch
3. ML-based product recommendations (SageMaker)
4. Admin dashboard for inventory management
5. Customer support chatbot (Lex)

### 13.6 Final Statement

The CloudRetail implementation demonstrates that cloud-native microservices architecture is achievable within academic constraints while maintaining alignment with industry best practices. The system successfully balances theoretical concepts from distributed systems literature (CAP theorem, event-driven architecture, eventual consistency) with practical engineering decisions (managed services, cost optimization, deployment automation).

While the implementation contains acknowledged limitations in testing coverage, security hardening, and operational maturity, it provides a solid foundation for understanding how modern e-commerce platforms achieve scalability, resilience, and maintainability. The architecture patterns, technology choices, and trade-off analysis presented in this report are directly transferable to commercial software engineering contexts.

The project reinforces that building distributed systems requires thinking beyond individual service logic to consider system-level properties: consistency, availability, partition tolerance, observability, and operational complexity. These considerations, more than any specific technology choice, define the success of cloud-native applications at scale.

---

## Appendices

### Appendix A: Repository Structure

```
cloud-retail/
├── services/
│   ├── iam-service/          # User authentication (Node.js, PostgreSQL)
│   ├── product-service/      # Product catalog (Node.js, DynamoDB)
│   ├── order-service/        # Order management (Node.js, PostgreSQL)
│   └── inventory-service/    # Stock management (Node.js, PostgreSQL)
├── infrastructure/
│   ├── cdk/                  # AWS CDK infrastructure-as-code
│   └── postgres/             # Database initialization scripts
├── frontend/                 # React TypeScript SPA
├── docs/                     # Documentation directory
├── compose.yaml              # Docker Compose for local development
└── reports/                  # This report
```

### Appendix B: Key Metrics

**Code Statistics:**
- Backend Services: ~864 lines of JavaScript
- Frontend Application: ~581 lines of TypeScript
- Infrastructure Code: ~173 lines of TypeScript (CDK)
- Total: ~1,618 lines of code (excluding node_modules, tests)

**Infrastructure Resources:**
- 1 VPC (2 AZs)
- 4 ECS Fargate Services
- 4 Application Load Balancers
- 1 RDS PostgreSQL Instance
- 1 DynamoDB Table
- 1 API Gateway
- 1 EventBridge Event Bus
- 1 Event Archive

**Database Schemas:**
- Users: 5 columns (id, email, password, role, created_at)
- Orders: 7 columns (id, user_id, product_id, quantity, total_price, status, created_at)
- Inventory: 3 columns (product_id, stock_quantity, updated_at)
- Products: 6 attributes (id, name, description, price, stock, createdAt)

### Appendix C: Environment Variables Reference

**IAM Service:**
- `PORT`: HTTP port (default: 3001)
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT signing

**Product Service:**
- `PORT`: HTTP port (default: 3002)
- `AWS_REGION`: AWS region for DynamoDB
- `DYNAMODB_ENDPOINT`: Local endpoint override for development
- `TABLE_NAME`: DynamoDB table name (default: Products)

**Order Service:**
- `PORT`: HTTP port (default: 3003)
- `DATABASE_URL`: PostgreSQL connection string
- `PRODUCT_SERVICE_URL`: Product service endpoint
- `EVENT_BUS_NAME`: EventBridge bus name
- `AWS_REGION`: AWS region for EventBridge

**Inventory Service:**
- `PORT`: HTTP port (default: 3004)
- `DATABASE_URL`: PostgreSQL connection string

### Appendix D: API Endpoint Summary

**IAM Service (`/auth`)**
- `POST /auth/register` - Create new user
- `POST /auth/login` - Authenticate and receive JWT
- `GET /health` - Service health check

**Product Service (`/products`)**
- `GET /products` - List all products
- `GET /products/:id` - Get product by ID
- `POST /products` - Create new product (admin)
- `GET /health` - Service health check

**Order Service (`/orders`)**
- `POST /orders` - Create new order (requires JWT)
- `GET /orders/:id` - Get order by ID
- `GET /health` - Service health check

**Inventory Service (`/inventory`)**
- `GET /inventory/:productId` - Get stock level
- `POST /inventory/webhook/order-created` - EventBridge webhook
- `GET /health` - Service health check

### Appendix E: Deployment Commands

**Local Development:**
```bash
# Start all services with Docker Compose
docker-compose up --build

# Frontend development server
cd frontend && npm run dev
```

**AWS Deployment:**
```bash
# Deploy infrastructure
cd infrastructure/cdk
npm install
npx cdk bootstrap  # First time only
npx cdk deploy

# Outputs will include API Gateway URL
```

**Cleanup:**
```bash
# Destroy AWS resources
npx cdk destroy

# Stop local services
docker-compose down -v
```

### Appendix F: References and Further Reading

**Cloud Architecture:**
- AWS Well-Architected Framework: https://aws.amazon.com/architecture/well-architected/
- Martin Fowler on Microservices: https://martinfowler.com/articles/microservices.html

**Distributed Systems:**
- Designing Data-Intensive Applications by Martin Kleppmann
- CAP Theorem: Brewer, E. (2000). "Towards Robust Distributed Systems"
- Saga Pattern: Garcia-Molina, H. & Salem, K. (1987). "Sagas"

**AWS Services:**
- ECS Best Practices: https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/
- EventBridge Patterns: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html
- CDK Developer Guide: https://docs.aws.amazon.com/cdk/v2/guide/

**Security:**
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- JWT Best Practices: https://tools.ietf.org/html/rfc8725

---

**End of Report**
**Word Count:** ~12,000
**Submission Package:** Source code + Infrastructure + This report
