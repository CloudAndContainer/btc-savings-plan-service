# Migration Plan: AWS CDK to Terraform

This document outlines the approach to migrate the infrastructure from AWS CDK to Terraform, focusing on a smooth transition while maintaining operational stability and developer experience.

## 1. Migration Approach

### Phased Migration Strategy

A phased "strangler fig" pattern migration that enables gradual transition without disrupting operations:

1. **Discovery & Assessment**
   - Audit existing CDK infrastructure
   - Document interdependencies between services
   - Create cloud architecture diagrams
   - Establish migration metrics and success criteria

2. **Parallel Infrastructure**
   - Set up Terraform tooling and CI/CD pipelines
   - Define Terraform modules corresponding to CDK constructs
   - Implement state management with S3 backend and DynamoDB locking
   - Create one-to-one mapping between CDK stacks and Terraform modules

3. **Component-by-Component Migration**
   - Start with less critical, standalone services
   - Use Terraform import to bring existing infrastructure under Terraform control
   - Apply "expand and contract" pattern for seamless transitions
   - Prioritize migration in this order:
     1. Static resources (S3, CloudFront)
     2. Storage services (DynamoDB, S3 data buckets)
     3. Integration components (EventBridge, SQS, SNS)
     4. Compute resources (Lambda functions)
     5. API layers (API Gateway)

4. **Validation & Optimization**
   - Ensure feature parity with CDK implementation
   - Optimize Terraform configurations
   - Document best practices
   - Refine developer workflows

### State Management

- Use remote backend with S3 for state storage and DynamoDB for state locking
- Implement fine-grained state separation, one state file per logical service
- Ensure state files are encrypted at rest
- Implement state file backup and versioning

### Import Approach

To minimize disruption, import existing infrastructure resources:

```bash
# Example import for an existing DynamoDB table
terraform import module.savings_plan.aws_dynamodb_table.savings_plans_table \
  savings-plans-prod
```

## 2. Infrastructure as Code Structure

### Repository Organization

```
terraform/
├── modules/              # Reusable infrastructure components
│   ├── api-gateway/      # API Gateway module
│   ├── dynamodb/         # DynamoDB tables module
│   ├── event-bridge/     # EventBridge resources module
│   ├── lambda/           # Lambda functions module
│   ├── monitoring/       # CloudWatch monitoring module
│   └── security/         # IAM and security module
├── environments/         # Environment-specific configurations
│   ├── dev/
│   ├── staging/
│   └── prod/
├── services/             # Business domain services
│   ├── savings-plan/     # Savings Plan service
│   ├── transactions/     # Transaction processing service
│   └── notifications/    # Notification service
├── .github/              # CI/CD workflows
└── scripts/              # Utility scripts for deployment
```

### Module Structure

Each service module will maintain a consistent structure:

```
services/savings-plan/
├── main.tf           # Main service configuration
├── variables.tf      # Input variables
├── outputs.tf        # Exported outputs
├── providers.tf      # Provider configuration
├── data.tf           # Data sources
├── api.tf            # API Gateway resources
├── lambda.tf         # Lambda functions
├── dynamodb.tf       # DynamoDB tables
├── events.tf         # EventBridge resources
├── monitoring.tf     # CloudWatch alarms and dashboards
└── README.md         # Documentation
```

### Environment Management

- Environment-specific configurations stored in separate directories
- Use Terraform workspaces for environment isolation
- Leverage common modules with environment-specific parameters
- Define environment-specific variables in `terraform.tfvars` files

```hcl
# environments/prod/main.tf
module "savings_plan" {
  source = "../../services/savings-plan"
  
  environment = "prod"
  log_retention_days = 365
  enable_tracing = true
  api_throttling = {
    rate_limit = 500
    burst_limit = 1000
  }
}
```

## 3. CI/CD Integration

- GitHub Actions workflows for automated testing and deployment
- Pull request validation including:
  - Terraform format check
  - Terraform validation
  - Security scanning
  - Cost estimation
- Automated plan generation on PR creation
- Approval workflows for production deployments
- Post-deployment verification tests

## 4. CDK vs Terraform Comparison

### Example: Savings Plan Service - DynamoDB Table

**CDK Implementation:**

```typescript
// Original CDK implementation
this.table = new dynamodb.Table(this, 'SavingsPlansTable', {
  tableName: props.tableName ?? `savings-plans-${props.stage}`,
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'planId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  timeToLiveAttribute: 'ttl',
});

// Add GSI for querying active plans by next execution time
this.table.addGlobalSecondaryIndex({
  indexName: 'StatusNextExecutionIndex',
  partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'nextExecutionTime', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**Terraform Implementation:**

```hcl
# Equivalent Terraform implementation
resource "aws_dynamodb_table" "savings_plans_table" {
  name         = var.table_name != null ? var.table_name : "savings-plans-${var.stage}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "planId"
  
  attribute {
    name = "userId"
    type = "S"
  }
  
  attribute {
    name = "planId"
    type = "S"
  }
  
  attribute {
    name = "status"
    type = "S"
  }
  
  attribute {
    name = "nextExecutionTime"
    type = "N"
  }
  
  global_secondary_index {
    name            = "StatusNextExecutionIndex"
    hash_key        = "status"
    range_key       = "nextExecutionTime"
    projection_type = "ALL"
  }
  
  server_side_encryption {
    enabled = true
  }
  
  point_in_time_recovery {
    enabled = true
  }
  
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  
  lifecycle {
    prevent_destroy = true
  }
  
  tags = {
    Environment = var.stage
    Service     = "SavingsPlan"
    ManagedBy   = "Terraform"
  }
}
```

### Key Differences

1. **Syntax and Structure**
   - CDK uses object-oriented TypeScript with method chaining
   - Terraform uses declarative HCL with explicit resource definitions

2. **Resource References**
   - CDK uses constructor references (e.g., `this.table`)
   - Terraform uses string interpolation or output references

3. **Type Safety**
   - CDK provides compile-time type checking
   - Terraform relies on runtime validation

4. **Extensibility**
   - CDK allows custom constructs with embedded logic
   - Terraform uses modules for code reuse

5. **Cloud Provider Support**
   - CDK is AWS-focused (though CDK for Terraform exists)
   - Terraform is cloud-agnostic with provider plugins

6. **State Management**
   - CDK uses CloudFormation for state management
   - Terraform has explicit state management

## 5. Secrets Management

A more robust secrets management approach during the migration:

```hcl
# In Terraform
module "api_keys" {
  source = "./modules/secrets"
  
  secret_name        = "bitcoin-exchange-api-keys"
  secret_description = "API keys for bitcoin exchange"
  secret_value       = {
    api_key    = var.exchange_api_key
    api_secret = var.exchange_api_secret
  }
  
  automatic_rotation = true
  rotation_days      = 30
}

# Reference in Lambda
resource "aws_lambda_function" "transaction_service" {
  # ... other configuration ...
  
  environment {
    variables = {
      SECRETS_ARN = module.api_keys.secret_arn
    }
  }
}
```

Lambda functions will use the AWS SDK to retrieve secrets at runtime, with appropriate IAM permissions granted for least privilege access.
