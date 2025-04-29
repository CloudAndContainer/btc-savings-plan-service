// lambda/transaction/executor.ts
import { SQSEvent, SQSRecord, Context, SQSBatchItemFailure, SQSBatchResponse } from 'aws-lambda';
import { DynamoDB, EventBridge } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { 
  SchedulerExecutionEvent, 
  SavingsPlan, 
  SavingsPlanTransaction, 
  SavingsPlanStatus, 
  SavingsPlanFrequency,
  EventType
} from '../scheduler/types';
import { BitcoinExchangeClient } from './exchange-client';

// Initialize AWS SDK clients
const dynamoDB = new DynamoDB.DocumentClient({
  maxRetries: 3,
  retryDelayOptions: { base: 200 },
});
const eventBridge = new EventBridge({ apiVersion: '2015-10-07' });

// Environment variables (set by CDK)
const {
  SAVINGS_PLANS_TABLE,
  TRANSACTIONS_TABLE,
  EVENT_BUS_NAME,
  EXCHANGE_API_SECRET_ID,
  STAGE,
  MAX_RETRIES = '3',
  AWS_REGION,
} = process.env;

// Exchange client instance (initialized lazily)
let exchangeClient: BitcoinExchangeClient | null = null;

/**
 * Lambda handler for executing savings plan purchase transactions
 * 
 * This function processes messages from the SQS queue, executes the bitcoin purchase,
 * records the transaction, and updates the plan with the next execution time.
 * 
 * @param event - SQS event with execution events
 * @param context - Lambda context
 * @returns SQS batch response with failed items
 */
export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
  console.log(`Executor - Processing ${event.Records.length} execution events`, {
    requestId: context.awsRequestId,
    stage: STAGE,
    region: AWS_REGION,
    timestamp: new Date().toISOString()
  });
  
  // Initialize exchange client if not already done
  if (!exchangeClient) {
    exchangeClient = await BitcoinExchangeClient.createFromSecrets(
      EXCHANGE_API_SECRET_ID!,
      STAGE!
    );
  }
  
  // Track failed items for batch response
  const batchItemFailures: SQSBatchItemFailure[] = [];
  
  // Process each record in sequence
  for (const record of event.Records) {
    try {
      await processExecutionEvent(record);
    } catch (error) {
      console.error(`Failed to process record ${record.messageId}:`, error);
      
      // Add to batch failures for SQS visibility timeout handling
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  
  // Log processing results
  console.log('Executor - Completed processing', {
    totalRecords: event.Records.length,
    failedRecords: batchItemFailures.length,
    successRecords: event.Records.length - batchItemFailures.length,
  });
  
  // Return batch item failures for SQS to retry
  return { batchItemFailures };
};

/**
 * Process a single execution event from SQS
 * 
 * @param record - SQS record containing execution event
 */
async function processExecutionEvent(record: SQSRecord): Promise<void> {
  let executionEvent: SchedulerExecutionEvent;
  
  try {
    // Parse execution event from SQS message
    executionEvent = JSON.parse(record.body) as SchedulerExecutionEvent;
    
    console.log(`Processing execution event for plan ${executionEvent.planId}`, {
      userId: executionEvent.userId,
      executionId: executionEvent.executionId,
      attemptCount: executionEvent.attemptCount,
    });
    
    // Check if we've exceeded maximum retry attempts
    if (executionEvent.attemptCount >= parseInt(MAX_RETRIES!, 10)) {
      console.error(`Maximum retry attempts exceeded for plan ${executionEvent.planId}`);
      
      // Handle maximum retries exceeded
      await handleMaxRetries(executionEvent);
      return;
    }
    
    // Retrieve savings plan from DynamoDB
    const plan = await getSavingsPlan(executionEvent.userId, executionEvent.planId);
    
    // Update plan status to EXECUTING
    await updatePlanStatus(plan, SavingsPlanStatus.EXECUTING);
    
    // Publish execution started event
    await publishEvent(EventType.EXECUTION_STARTED, {
      userId: plan.userId,
      planId: plan.planId,
      executionId: executionEvent.executionId,
      amount: plan.amount,
      attemptCount: executionEvent.attemptCount,
    });
    
    // Execute bitcoin purchase
    const purchaseResult = await exchangeClient!.purchaseBitcoin({
      userId: plan.userId,
      amount: plan.amount,
      sourceOfFunds: plan.sourceOfFunds,
      clientRequestId: executionEvent.executionId,
    });
    
    // Create transaction record
    const transaction: SavingsPlanTransaction = {
      userId: plan.userId,
      transactionId: uuidv4(),
      planId: plan.planId,
      amount: plan.amount,
      bitcoinAmount: purchaseResult.bitcoinAmount || 0,
      exchangeRate: purchaseResult.exchangeRate || 0,
      status: purchaseResult.success ? 'COMPLETED' : 'FAILED',
      timestamp: new Date().toISOString(),
      errorMessage: purchaseResult.errorMessage,
      metadata: {
        executionId: executionEvent.executionId,
        exchangeTransactionId: purchaseResult.exchangeTransactionId,
        attemptCount: executionEvent.attemptCount,
        fees: purchaseResult.fees,
      },
    };
    
    // Store transaction in DynamoDB
    await recordTransaction(transaction);
    
    if (purchaseResult.success) {
      // Calculate next execution time
      const nextExecutionTime = calculateNextExecutionTime(plan.frequency, new Date());
      
      // Update plan with next execution time
      await updatePlanWithNextExecution(plan, nextExecutionTime);
      
      // Publish execution completed event
      await publishEvent(EventType.EXECUTION_COMPLETED, {
        userId: plan.userId,
        planId: plan.planId,
        executionId: executionEvent.executionId,
        transactionId: transaction.transactionId,
        amount: plan.amount,
        bitcoinAmount: transaction.bitcoinAmount,
        nextExecutionTime,
      });
      
      console.log(`Successfully executed plan ${plan.planId}`, {
        transactionId: transaction.transactionId,
        bitcoinAmount: transaction.bitcoinAmount,
        nextExecutionTime,
      });
    } else {
      // Handle failed purchase
      console.error(`Purchase failed for plan ${plan.planId}:`, purchaseResult.errorMessage);
      
      // Update plan status to FAILED
      await updatePlanStatus(plan, SavingsPlanStatus.FAILED);
      
      // Publish execution failed event
      await publishEvent(EventType.EXECUTION_FAILED, {
        userId: plan.userId,
        planId: plan.planId,
        executionId: executionEvent.executionId,
        transactionId: transaction.transactionId,
        amount: plan.amount,
        errorMessage: purchaseResult.errorMessage,
        attemptCount: executionEvent.attemptCount,
      });
      
      // Throw error to trigger retry via SQS
      throw new Error(`Purchase failed: ${purchaseResult.errorMessage}`);
    }
  } catch (error) {
    console.error('Error processing execution event:', error);
    
    // Enhance error logging
    if (error instanceof Error) {
      console.error({
        errorMessage: error.message,
        errorName: error.name,
        stackTrace: error.stack,
      });
    }
    
    // Rethrow to notify SQS of failure
    throw error;
  }
}

/**
 * Retrieve a savings plan from DynamoDB
 * 
 * @param userId - User ID
 * @param planId - Plan ID
 * @returns The savings plan
 * @throws Error if plan is not found
 */
async function getSavingsPlan(userId: string, planId: string): Promise<SavingsPlan> {
  const getParams = {
    TableName: SAVINGS_PLANS_TABLE!,
    Key: {
      userId,
      planId,
    },
  };
  
  const result = await dynamoDB.get(getParams).promise();
  
  if (!result.Item) {
    throw new Error(`Savings plan ${planId} for user ${userId} not found`);
  }
  
  return result.Item as SavingsPlan;
}

/**
 * Update a savings plan status in DynamoDB
 * 
 * @param plan - The savings plan to update
 * @param status - The new status
 */
async function updatePlanStatus(plan: SavingsPlan, status: SavingsPlanStatus): Promise<void> {
  const updateParams = {
    TableName: SAVINGS_PLANS_TABLE!,
    Key: {
      userId: plan.userId,
      planId: plan.planId,
    },
    UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
    ConditionExpression: 'attribute_exists(planId)', // Ensure plan exists
    ExpressionAttributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
    },
  };
  
  await dynamoDB.update(updateParams).promise();
}

/**
 * Update a savings plan with next execution time
 * 
 * @param plan - The savings plan to update
 * @param nextExecutionTime - The next execution time in Unix seconds
 */
async function updatePlanWithNextExecution(plan: SavingsPlan, nextExecutionTime: number): Promise<void> {
  const updateParams = {
    TableName: SAVINGS_PLANS_TABLE!,
    Key: {
      userId: plan.userId,
      planId: plan.planId,
    },
    UpdateExpression: 'SET #status = :status, #nextExecution = :nextExecution, #updatedAt = :updatedAt',
    ConditionExpression: 'attribute_exists(planId)', // Ensure plan exists
    ExpressionAttributeNames: {
      '#status': 'status',
      '#nextExecution': 'nextExecutionTime',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':status': SavingsPlanStatus.ACTIVE,
      ':nextExecution': nextExecutionTime,
      ':updatedAt': new Date().toISOString(),
    },
  };
  
  await dynamoDB.update(updateParams).promise();
}

/**
 * Record a transaction in DynamoDB
 * 
 * @param transaction - The transaction to record
 */
async function recordTransaction(transaction: SavingsPlanTransaction): Promise<void> {
  const putParams = {
    TableName: TRANSACTIONS_TABLE!,
    Item: transaction,
    ConditionExpression: 'attribute_not_exists(transactionId)', // Ensure idempotency
  };
  
  await dynamoDB.put(putParams).promise();
}

/**
 * Handle maximum retries exceeded
 * 
 * @param event - The execution event
 */
async function handleMaxRetries(event: SchedulerExecutionEvent): Promise<void> {
  try {
    // Retrieve savings plan
    const plan = await getSavingsPlan(event.userId, event.planId);
    
    // Update plan status to FAILED
    await updatePlanStatus(plan, SavingsPlanStatus.FAILED);
    
    // Create failure transaction record
    const transaction: SavingsPlanTransaction = {
      userId: plan.userId,
      transactionId: uuidv4(),
      planId: plan.planId,
      amount: plan.amount,
      bitcoinAmount: 0,
      exchangeRate: 0,
      status: 'FAILED',
      timestamp: new Date().toISOString(),
      errorMessage: `Maximum retry attempts (${MAX_RETRIES}) exceeded`,
      metadata: {
        executionId: event.executionId,
        attemptCount: event.attemptCount,
        maxRetries: MAX_RETRIES,
      },
    };
    
    // Record transaction
    await recordTransaction(transaction);
    
    // Publish execution failed event
    await publishEvent(EventType.EXECUTION_FAILED, {
      userId: plan.userId,
      planId: plan.planId,
      executionId: event.executionId,
      transactionId: transaction.transactionId,
      amount: plan.amount,
      errorMessage: transaction.errorMessage,
      attemptCount: event.attemptCount,
      maxRetriesExceeded: true,
    });
    
    console.log(`Max retries exceeded for plan ${plan.planId}. Updated status to FAILED.`);
  } catch (error) {
    console.error('Error handling max retries:', error);
    throw error;
  }
}

/**
 * Publish an event to EventBridge
 * 
 * @param eventType - Type of event
 * @param detail - Event details
 */
async function publishEvent(eventType: EventType, detail: Record<string, any>): Promise<void> {
  const params = {
    Entries: [
      {
        Source: 'bitcoin-broker.scheduler',
        DetailType: eventType,
        Detail: JSON.stringify({
          ...detail,
          timestamp: new Date().toISOString(),
          stage: STAGE,
        }),
        EventBusName: EVENT_BUS_NAME!,
      },
    ],
  };
  
  await eventBridge.putEvents(params).promise();
}

/**
 * Calculate the next execution time based on frequency
 * 
 * @param frequency - The frequency of the savings plan
 * @param from - The date to calculate from
 * @returns Unix timestamp in seconds for the next execution
 */
function calculateNextExecutionTime(frequency: SavingsPlanFrequency, from: Date): number {
  const nextDate = new Date(from);
  
  switch (frequency) {
    case SavingsPlanFrequency.DAILY:
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case SavingsPlanFrequency.WEEKLY:
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case SavingsPlanFrequency.BIWEEKLY:
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    case SavingsPlanFrequency.MONTHLY:
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    default:
      throw new Error(`Unsupported frequency: ${frequency}`);
  }
  
  // Return Unix timestamp in seconds
  return Math.floor(nextDate.getTime() / 1000);
}
