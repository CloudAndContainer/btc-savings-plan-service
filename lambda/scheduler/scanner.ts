// lambda/scheduler/scanner.ts
import { ScheduledEvent, Context, ScheduledHandler } from 'aws-lambda';
import { DynamoDB, SQS, EventBridge } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { SavingsPlan, SavingsPlanStatus, SchedulerExecutionEvent, EventType } from './types';

// Validate and assert required environment variables
const SAVINGS_PLANS_TABLE = process.env.SAVINGS_PLANS_TABLE!;
if (!process.env.SAVINGS_PLANS_TABLE) {
  throw new Error('SAVINGS_PLANS_TABLE environment variable is required');
}

const EXECUTION_QUEUE_URL = process.env.EXECUTION_QUEUE_URL!;
if (!process.env.EXECUTION_QUEUE_URL) {
  throw new Error('EXECUTION_QUEUE_URL environment variable is required');
}

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
if (!process.env.EVENT_BUS_NAME) {
  throw new Error('EVENT_BUS_NAME environment variable is required');
}

// Optional environment variables with defaults
const MAX_BATCH_SIZE = process.env.MAX_BATCH_SIZE || '25';
const STAGE = process.env.STAGE || 'dev';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Initialize AWS SDK clients
const dynamoDB = new DynamoDB.DocumentClient({
  maxRetries: 3,
  retryDelayOptions: { base: 200 },
});
const sqs = new SQS({ apiVersion: '2012-11-05' });
const eventBridge = new EventBridge({ apiVersion: '2015-10-07' });

/**
 * Lambda handler for scanning active savings plans due for execution
 * 
 * This function is triggered by EventBridge on a schedule and scans
 * the DynamoDB table for active plans due for execution. It then
 * queues them for processing by the executor Lambda.
 * 
 * @param event - EventBridge scheduled event
 * @param context - Lambda context
 */
export const handler: ScheduledHandler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  console.log('Scheduler Scanner - Starting scan for due plans', { 
    requestId: context.awsRequestId,
    stage: STAGE,
    region: AWS_REGION,
    timestamp: new Date().toISOString()
  });
  
  // Current Unix timestamp in seconds
  const now = Math.floor(Date.now() / 1000);
  
  try {
    // Scan for active plans that are due for execution
    // Using GSI StatusNextExecutionIndex to efficiently query by status and time
    const queryParams = {
      TableName: SAVINGS_PLANS_TABLE,
      IndexName: 'StatusNextExecutionIndex',
      KeyConditionExpression: '#status = :status AND #nextExecution <= :now',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#nextExecution': 'nextExecutionTime',
      },
      ExpressionAttributeValues: {
        ':status': SavingsPlanStatus.ACTIVE,
        ':now': now,
      },
      Limit: parseInt(MAX_BATCH_SIZE, 10),
    };
    
    // Log query parameters for debugging
    console.log('Querying for due plans', { queryParams });
    
    // Execute query
    const queryResult = await dynamoDB.query(queryParams).promise();
    
    // Check if we have any plans to process
    if (!queryResult.Items || queryResult.Items.length === 0) {
      console.log('No savings plans found due for execution');
      return;
    }
    
    // Process plans
    const plans = queryResult.Items as SavingsPlan[];
    
    console.log(`Found ${plans.length} savings plans due for execution`);
    
    // Process each plan
    const processPromises = plans.map(plan => processPlansForExecution(plan));
    
    // Wait for all plans to be processed
    const results = await Promise.allSettled(processPromises);
    
    // Log results
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;
    
    console.log('Scheduler Scanner - Completed', {
      totalPlans: plans.length,
      successCount,
      failureCount,
    });
    
    // If any failures, log them in detail
    if (failureCount > 0) {
      results
        .filter(r => r.status === 'rejected')
        .forEach((r, idx) => {
          console.error(`Failed to process plan ${idx}:`, (r as PromiseRejectedResult).reason);
        });
      
      // Throw an error to trigger Lambda retry if any plans failed
      if (failureCount > 0) {
        throw new Error(`Failed to process all ${failureCount} plans`);
      }
    }
  } catch (error) {
    console.error('Error scanning for savings plans:', error);
    
    // Enhance error logging for operational visibility
    if (error instanceof Error) {
      console.error({
        errorMessage: error.message,
        errorName: error.name,
        stackTrace: error.stack,
        requestId: context.awsRequestId,
      });
    }
    
    // Rethrow to trigger Lambda retry mechanism
    throw error;
  }
};

/**
 * Process a savings plan for execution
 * 
 * This function:
 * 1. Updates the plan status to PENDING_EXECUTION
 * 2. Enqueues the plan for execution
 * 3. Publishes an event to EventBridge
 * 
 * @param plan - The savings plan to process
 */
async function processPlansForExecution(plan: SavingsPlan): Promise<void> {
  const executionId = uuidv4();
  const currentTime = new Date().toISOString();
  
  try {
    console.log(`Processing plan ${plan.planId} for user ${plan.userId}`);
    
    // Update plan status to PENDING_EXECUTION
    await updatePlanStatus(plan, SavingsPlanStatus.PENDING_EXECUTION);
    
    // Create execution event
    const executionEvent: SchedulerExecutionEvent = {
      userId: plan.userId,
      planId: plan.planId,
      executionTime: currentTime,
      executionId,
      attemptCount: 0,
    };
    
    // Send message to SQS queue
    await sqs.sendMessage({
      QueueUrl: EXECUTION_QUEUE_URL!,
      MessageBody: JSON.stringify(executionEvent),
      MessageDeduplicationId: executionId, // Prevent duplicate processing
      MessageGroupId: plan.userId, // Group by user to maintain order per user
    }).promise();
    
    // Publish event to EventBridge for audit and tracking
    await eventBridge.putEvents({
      Entries: [{
        Source: 'bitcoin-broker.scheduler',
        DetailType: EventType.EXECUTION_SCHEDULED,
        Detail: JSON.stringify({
          userId: plan.userId,
          planId: plan.planId,
          executionId,
          amount: plan.amount,
          frequency: plan.frequency,
          scheduledTime: currentTime,
        }),
        EventBusName: EVENT_BUS_NAME,
      }],
    }).promise();
    
    console.log(`Plan ${plan.planId} for user ${plan.userId} scheduled for execution`, {
      executionId,
      scheduledTime: currentTime,
    });
  } catch (error) {
    console.error(`Error processing plan ${plan.planId} for user ${plan.userId}:`, error);
    
    // Try to update plan status back to ACTIVE if SQS or EventBridge operations failed
    try {
      await updatePlanStatus(plan, SavingsPlanStatus.ACTIVE);
    } catch (updateError) {
      console.error(`Failed to revert plan ${plan.planId} status to ACTIVE:`, updateError);
    }
    
    // Rethrow to handle at caller level
    throw error;
  }
}

/**
 * Update a savings plan status in DynamoDB
 * 
 * @param plan - The savings plan to update
 * @param status - The new status
 */
async function updatePlanStatus(plan: SavingsPlan, status: SavingsPlanStatus): Promise<void> {
  const updateParams = {
    TableName: SAVINGS_PLANS_TABLE,
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
    ReturnValues: 'ALL_NEW',
  };
  
  try {
    await dynamoDB.update(updateParams).promise();
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.error(`Plan ${plan.planId} for user ${plan.userId} no longer exists`);
      }
    }
    throw error; // Rethrow for caller to handle
  }
}
