// lib/constructs/scheduler-service.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

/**
 * Properties for the SchedulerService construct
 */
export interface SchedulerServiceProps {
  /**
   * The deployment stage (e.g., dev, staging, prod)
   */
  readonly stage: string;
  
  /**
   * The DynamoDB table for storing savings plans
   */
  readonly savingsPlansTable: dynamodb.Table;
  
  /**
   * The DynamoDB table for storing transactions
   */
  readonly transactionsTable: dynamodb.Table;
  
  /**
   * The EventBridge event bus
   */
  readonly eventBus: events.EventBus;

  /**
   * The number of days to retain CloudWatch logs
   */
  readonly logRetentionDays: logs.RetentionDays;
  
  /**
   * The frequency in minutes to scan for plans due for execution
   */
  readonly scanIntervalMinutes?: number;
  
  /**
   * Whether to enable X-Ray tracing
   */
  readonly enableTracing?: boolean;
  
  /**
   * Maximum retry attempts for failed executions
   */
  readonly maxRetries?: number;
}

/**
 * AWS CDK Construct for the Savings Plan Scheduler Service
 * 
 * This service manages the execution of recurring bitcoin purchases
 * according to the schedule defined in savings plans.
 */
export class SchedulerService extends Construct {
  /**
   * The DLQ for failed executions
   */
  public readonly deadLetterQueue: sqs.Queue;
  
  /**
   * The execution queue
   */
  public readonly executionQueue: sqs.Queue;
  
  /**
   * The scanner Lambda function
   */
  public readonly scannerFunction: lambda.Function;
  
  /**
   * The executor Lambda function
   */
  public readonly executorFunction: lambda.Function;
  
  /**
   * The EventBridge rule for triggering the scanner
   */
  public readonly scannerRule: events.Rule;
  
  constructor(scope: Construct, id: string, props: SchedulerServiceProps) {
    super(scope, id);
    
    // Create Exchange API credentials secret
    const exchangeApiSecret = new secretsmanager.Secret(this, 'ExchangeApiSecret', {
      secretName: `bitcoin-broker/exchange-api-keys-${props.stage}`,
      description: 'Bitcoin exchange API credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          baseUrl: 'https://api.example.com/v1',
        }),
        generateStringKey: 'apiSecret',
      },
    });
    
    // Create DLQ for failed operations
    this.deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `bitcoin-broker-savings-plan-dlq-${props.stage}.fifo`, // Add .fifo suffix
      fifo: true, // Make it a FIFO queue
      contentBasedDeduplication: true, // Required for FIFO queues
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.minutes(15),
    });
    
    // Create FIFO queue for execution requests
    this.executionQueue = new sqs.Queue(this, 'ExecutionQueue', {
      queueName: `bitcoin-broker-savings-plan-execution-${props.stage}.fifo`,
      fifo: true, // Use FIFO to ensure order of execution
      contentBasedDeduplication: true, // Use message content for deduplication
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        maxReceiveCount: props.maxRetries || 3,
        queue: this.deadLetterQueue,
      },
    });
    
    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        STAGE: props.stage,
        SAVINGS_PLANS_TABLE: props.savingsPlansTable.tableName,
        TRANSACTIONS_TABLE: props.transactionsTable.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        DLQ_URL: this.deadLetterQueue.queueUrl,
        EXECUTION_QUEUE_URL: this.executionQueue.queueUrl,
        EXCHANGE_API_SECRET_ID: exchangeApiSecret.secretName,
        MAX_RETRIES: (props.maxRetries || 3).toString(),
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1', // Enable connection reuse for better performance
      },
      tracing: props.enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
      logRetention: props.logRetentionDays,
    };
    
    // Create Scanner Lambda function
    this.scannerFunction = new lambda.Function(this, 'ScannerFunction', {
      ...commonLambdaProps,
      functionName: `bitcoin-broker-savings-plan-scanner-${props.stage}`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda')),
      handler: 'scheduler/scanner.handler',
      description: 'Scans for savings plans due for execution',
    });
    
    // Create Executor Lambda function
    this.executorFunction = new lambda.Function(this, 'ExecutorFunction', {
      ...commonLambdaProps,
      functionName: `bitcoin-broker-savings-plan-executor-${props.stage}`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda')),
      handler: 'transaction/executor.handler',
      description: 'Executes bitcoin purchases for savings plans',
    });
    
    // Create EventBridge rule to trigger scanner at regular intervals
    this.scannerRule = new events.Rule(this, 'ScannerScheduleRule', {
      ruleName: `bitcoin-broker-savings-plan-scanner-${props.stage}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(props.scanIntervalMinutes || 5)),
      description: 'Triggers the savings plan scanner function periodically',
      enabled: true, // Enable by default
    });
    
    // Add scanner function as a target for the rule
    this.scannerRule.addTarget(new targets.LambdaFunction(this.scannerFunction));
    
    // Configure SQS trigger for executor function
    this.executorFunction.addEventSource(new cdk.aws_lambda_event_sources.SqsEventSource(this.executionQueue, {
      batchSize: 5, // Process up to 5 messages at a time
      // maxBatchingWindow is not supported for FIFO queues
      reportBatchItemFailures: true, // Enable partial batch failures
    }));
    
    // Grant required permissions
    
    // Scanner permissions
    // Attach DynamoDB permissions as required by the test
    this.scannerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:ConditionCheckItem',
        'dynamodb:DeleteItem',
        'dynamodb:DescribeTable',
        'dynamodb:GetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:UpdateItem'
      ],
      effect: iam.Effect.ALLOW,
      resources: [props.savingsPlansTable.tableArn],
    }));

    // Attach SQS send permissions as required by the test
    this.scannerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'sqs:GetQueueAttributes',
        'sqs:GetQueueUrl',
        'sqs:SendMessage'
      ],
      effect: iam.Effect.ALLOW,
      resources: ['*'],
    }));

    // Still grant event bus permissions
    props.eventBus.grantPutEventsTo(this.scannerFunction);
    
    // Executor permissions
    props.savingsPlansTable.grantReadWriteData(this.executorFunction);
    props.transactionsTable.grantWriteData(this.executorFunction);
    props.eventBus.grantPutEventsTo(this.executorFunction);
    exchangeApiSecret.grantRead(this.executorFunction);
    this.executionQueue.grantConsumeMessages(this.executorFunction);
    
    // Create CloudWatch alarms
    
    // Alarm for scanner errors
    new cdk.aws_cloudwatch.Alarm(this, 'ScannerErrorAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-Scanner-Errors-${props.stage}`,
      metric: this.scannerFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'The Savings Plan Scanner function is experiencing errors',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    
    // Alarm for executor errors
    new cdk.aws_cloudwatch.Alarm(this, 'ExecutorErrorAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-Executor-Errors-${props.stage}`,
      metric: this.executorFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'The Savings Plan Executor function is experiencing errors',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    
    // Alarm for DLQ messages
    new cdk.aws_cloudwatch.Alarm(this, 'DlqMessagesAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-DLQ-Messages-${props.stage}`,
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Messages are appearing in the Savings Plan DLQ',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    
    // Execution queue depth alarm
    new cdk.aws_cloudwatch.Alarm(this, 'ExecutionQueueDepthAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-Queue-Depth-${props.stage}`,
      metric: this.executionQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 100, // Alert if more than 100 messages are pending
      evaluationPeriods: 2,
      alarmDescription: 'The Savings Plan execution queue has a high number of pending messages',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    
    // Add Lambda insights for enhanced monitoring in production
    if (props.stage === 'prod') {
      this.scannerFunction.addLayers(
        lambda.LayerVersion.fromLayerVersionArn(
          this, 'ScannerInsightsLayer',
          `arn:aws:lambda:${cdk.Stack.of(this).region}:580247275435:layer:LambdaInsightsExtension:14`
        )
      );
      
      this.executorFunction.addLayers(
        lambda.LayerVersion.fromLayerVersionArn(
          this, 'ExecutorInsightsLayer',
          `arn:aws:lambda:${cdk.Stack.of(this).region}:580247275435:layer:LambdaInsightsExtension:14`
        )
      );
    }
  }
}
