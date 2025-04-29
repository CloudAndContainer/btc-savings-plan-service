import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

export interface SchedulerStackProps extends cdk.StackProps {
  stage: string;
  enableTracing: boolean;
  scanIntervalMinutes: number;
  maxRetries: number;
  logRetentionDays?: logs.RetentionDays;
}

export class SchedulerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);

    // Create DynamoDB tables
    const savingsPlansTable = new dynamodb.Table(this, 'SavingsPlansTable', {
      tableName: `bitcoin-broker-savings-plans-${props.stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'planId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const transactionsTable = new dynamodb.Table(this, 'TransactionsTable', {
      tableName: `bitcoin-broker-transactions-${props.stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'transactionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create SQS queues
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `bitcoin-broker-savings-plan-dlq-${props.stage}.fifo`, 
      fifo: true, 
      contentBasedDeduplication: true, 
      retentionPeriod: cdk.Duration.days(14),
    });

    const executionQueue = new sqs.Queue(this, 'ExecutionQueue', {
      queueName: `bitcoin-broker-savings-plan-execution-${props.stage}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: props.maxRetries,
      },
    });

    // Create EventBridge event bus
    const eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: `bitcoin-broker-events-${props.stage}`,
    });

    // Create scanner function
    const scannerFunction = new lambda.Function(this, 'ScannerFunction', {
      functionName: `bitcoin-broker-savings-plan-scanner-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'scheduler/scanner.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      environment: {
        STAGE: props.stage,
        TABLE_NAME: savingsPlansTable.tableName,
        QUEUE_URL: executionQueue.queueUrl,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      tracing: props.enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
      logRetention: props.logRetentionDays,
    });

    // Create executor function
    const executorFunction = new lambda.Function(this, 'ExecutorFunction', {
      functionName: `bitcoin-broker-savings-plan-executor-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'transaction/executor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      environment: {
        STAGE: props.stage,
        PLANS_TABLE_NAME: savingsPlansTable.tableName,
        TRANSACTIONS_TABLE_NAME: transactionsTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      tracing: props.enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
      logRetention: props.logRetentionDays,
    });

    // Set up EventBridge rule to trigger scanner
    const scannerRule = new events.Rule(this, 'ScannerScheduleRule', {
      ruleName: `bitcoin-broker-savings-plan-scanner-${props.stage}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(props.scanIntervalMinutes)),
      targets: [new targets.LambdaFunction(scannerFunction)],
    });

    // Set up SQS trigger for executor
    executorFunction.addEventSource(new lambdaEventSources.SqsEventSource(executionQueue, {
      batchSize: 10,
    }));

    // Grant permissions
    savingsPlansTable.grantReadWriteData(scannerFunction);
    executionQueue.grantSendMessages(scannerFunction);
    eventBus.grantPutEventsTo(scannerFunction);

    savingsPlansTable.grantReadWriteData(executorFunction);
    transactionsTable.grantWriteData(executorFunction);
    eventBus.grantPutEventsTo(executorFunction);
    executionQueue.grantConsumeMessages(executorFunction);

    // Create CloudWatch alarms
    new cdk.aws_cloudwatch.Alarm(this, 'ScannerErrorsAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-Scanner-Errors-${props.stage}`,
      metric: scannerFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
    });

    new cdk.aws_cloudwatch.Alarm(this, 'ExecutorErrorsAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-Executor-Errors-${props.stage}`,
      metric: executorFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
    });

    new cdk.aws_cloudwatch.Alarm(this, 'DLQMessagesAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-DLQ-Messages-${props.stage}`,
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
    });

    new cdk.aws_cloudwatch.Alarm(this, 'QueueDepthAlarm', {
      alarmName: `Bitcoin-Broker-SavingsPlan-Queue-Depth-${props.stage}`,
      metric: executionQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 100,
      evaluationPeriods: 2,
    });
  }
}
