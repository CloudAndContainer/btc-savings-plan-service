# Design Documentation: Bitcoin Savings Plan Buy Feature

## Architecture Overview

### User Service  
This service manages user authentication, KYC verification, and the maintenance of compliance-related documents, requiring only minor extensions to accommodate user savings preferences.

### Savings Plan Service  
This service is responsible for managing all configurations relating to recurring savings plans, including purchase frequency, amount, and fund source specifications. It encapsulates the validation logic required for business rules enforcement and serves as the primary publisher of events that trigger downstream workflows. 

### Scheduler Service  
This service is tasked with orchestrating the timed execution of purchases, this service will leverage AWS EventBridge Scheduler to maintain precise control over execution timing, ensuring timezone-specific adjustments.

### Transaction Service  
This service will oversee the actual Bitcoin purchase transactions via our exchange integrations, ensuring idempotency to avoid duplicate orders, incorporating fallback mechanisms to manage partial fills in volatile markets, and persisting complete transaction records to facilitate reconciliation and meet auditability requirements.

### Notification Service  
This service is for delivering timely transaction confirmations and critical alerts to users across multiple channels and service implements fallback strategies to guarantee message delivery and honors user-configured communication preferences.

### Audit Service  
This service is responsible for creating and maintaining an immutable audit trail for all critical operations, ensuring appropriate data retention periods, and supporting the generation of audit reports for both internal oversight and external regulatory review.

## Scalability Considerations

It is critical that the system architecture not only handles today's load but remains resilient under significantly increased usage, particularly around high-activity periods.

### Serverless-First Strategy  
The architecture embraces a serverless-first approach:

- Lambda functions will be configured with conservative concurrency limits, initially capped at 100 concurrent executions.
- DynamoDB will operate on on-demand capacity to dynamically absorb spikes in traffic without manual intervention.
- API Gateway throttling will be set to reasonable limits, starting at 1000 RPS, to safeguard backend services.
- CloudFront will be employed both for caching static content and buffering volatile request loads.

### Resilience Patterns  
The system will incorporate:

- Circuit breaker mechanisms around all external API calls
- Tuned SQS queue visibility timeouts to match service-level characteristics
- Enforced exponential backoff strategies with added jitter to mitigate retries in the event of transient failures
- Distributed transactions coordinated via the SAGA pattern to maintain consistency even in the face of partial system failures

## Event-Driven Architecture

Rather than adopting a monolithic or tightly coupled model, the Savings Plan Buy system has been designed as a hybrid event-driven architecture, balancing operational independence between services with the reliability required by a financial application.

### Primary Event Flow  
1. When a user creates a new savings plan, a `SavingsPlanCreated` event is emitted.  
2. The Scheduler Service consumes this event, provisions the necessary scheduled task, and emits a `ScheduleCreated` event.  
3. Upon the scheduled trigger time, the Scheduler emits a `PurchaseRequested` event onto an SQS queue.  
4. The Transaction Service processes the queue, executes the corresponding Bitcoin purchase, and emits a `PurchaseCompleted` event.  
5. The Notification Service consumes the purchase completion event and dispatches confirmation alerts to users.  
6. Simultaneously, all events are persisted by the Audit Service to ensure full historical traceability.

This model ensures that each domain operates autonomously yet remains coherently orchestrated through event flows, providing both scalability and operational agility.

### Data Storage and Retention  
- All personally identifiable information will be encrypted at rest utilizing AWS KMS, with separate encryption keys provisioned per environment to strengthen key management practices.
- Financial transaction data will adhere to FIPS 140-2 encryption standards, and all transaction records will be retained.
- Fine-grained tagging and classification will enable selective retrieval and deletion of records, should regulatory or legal requests necessitate such action.

### Audit Capabilities  
- In addition to enforcing comprehensive logging of all service activities with correlation identifiers, immutable audit logs will be stored within S3 and transitioned to Glacier after 90 days to balance operational cost with long-term retention requirements.
- All financial transactions will be digitally signed to provide non-repudiation guarantees.
- Monthly audit reports will be automatically generated to support both internal compliance reviews and regulatory filings.

## Technical Implementation Details

### Data Model  
- DynamoDB table using a composite key comprising `userId` and `planId`.  
- Global Secondary Indexes configured for querying by execution status and next scheduled execution.  
- Denormalized data layout to optimize query patterns and minimize latency.  
- Use of TTL attributes for scheduled clean-up of expired temporary records.

### API Design  
- RESTful API structure supporting create, read, update, and delete operations.  
- JWT-based authentication with custom authorizers for user validation.  
- Input validation handled through JSON Schema to enforce strict request integrity.  
- Tiered rate limiting applied based on user plan and transaction limits.

### Lambda Functions  
- Modularized deployment with specific functions dedicated to distinct business operations.  
- Common utility layers shared across functions for validation, error formatting, and logging.  
- Structured JSON format for all CloudWatch logs to facilitate query efficiency.  
- Robust error handling practices with typed custom exceptions and graceful fallback pathways.

### Monitoring and Alerting
- Dedicated CloudWatch dashboards for each logical service domain.  
- Latency-based alarms configured for all critical API endpoints, with a P95 threshold of 300 milliseconds.  
- Real-time SQS queue depth monitoring with auto-scaling policies attached.  
- Error rate alarms directly linked to alerting policies for rapid incident response.  
- Business intelligence dashboards tracking plan creation rates, execution success rates, and system health metrics.

### Cost Optimization
- Lambda functions have been right-sized based on anticipated processing load, ranging from 256MB for lightweight APIs to 1GB for heavier data-processing operations.  
- DynamoDB is configured with on-demand billing for production workloads, while development and staging environments use provisioned capacity.  
- Logs retention periods are customized to minimize unnecessary storage costs while ensuring compliance requirements are met.  
- All CloudWatch Insights queries have been tuned to minimize scanned data volumes, reducing both latency and cost.
