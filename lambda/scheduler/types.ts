// lambda/scheduler/types.ts
/**
 * Possible frequencies for a savings plan
 */
export enum SavingsPlanFrequency {
    DAILY = 'DAILY',
    WEEKLY = 'WEEKLY',
    BIWEEKLY = 'BIWEEKLY',
    MONTHLY = 'MONTHLY',
  }
  
  /**
   * Possible statuses for a savings plan
   */
  export enum SavingsPlanStatus {
    ACTIVE = 'ACTIVE',
    PAUSED = 'PAUSED',
    PENDING_EXECUTION = 'PENDING_EXECUTION',
    EXECUTING = 'EXECUTING',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    FAILED = 'FAILED',
  }
  
  /**
   * Interface for a Savings Plan
   */
  export interface SavingsPlan {
    /**
     * User identifier (partition key)
     */
    userId: string;
    
    /**
     * Plan identifier (sort key)
     */
    planId: string;
    
    /**
     * Amount to purchase in USD
     */
    amount: number;
    
    /**
     * Frequency of purchases
     */
    frequency: SavingsPlanFrequency;
    
    /**
     * Source of funds for purchases (e.g., bank account, credit card)
     */
    sourceOfFunds: string;
    
    /**
     * Current status of the plan
     */
    status: SavingsPlanStatus;
    
    /**
     * Next execution time (Unix timestamp in seconds)
     */
    nextExecutionTime: number;
    
    /**
     * Start date in ISO 8601 format
     */
    startDate: string;
    
    /**
     * Optional end date for the plan (ISO 8601 format)
     */
    endDate?: string;
    
    /**
     * Creation timestamp in ISO 8601 format
     */
    createdAt: string;
    
    /**
     * Last update timestamp in ISO 8601 format
     */
    updatedAt: string;
  }
  
  /**
   * Interface for a Savings Plan purchase transaction
   */
  export interface SavingsPlanTransaction {
    /**
     * User identifier
     */
    userId: string;
    
    /**
     * Transaction identifier
     */
    transactionId: string;
    
    /**
     * Plan identifier
     */
    planId: string;
    
    /**
     * Amount purchased in USD
     */
    amount: number;
    
    /**
     * Amount of bitcoin purchased
     */
    bitcoinAmount: number;
    
    /**
     * Exchange rate at time of purchase (USD per BTC)
     */
    exchangeRate: number;
    
    /**
     * Status of the transaction
     */
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    
    /**
     * Timestamp of the transaction in ISO 8601 format
     */
    timestamp: string;
    
    /**
     * Optional error message if the transaction failed
     */
    errorMessage?: string;
    
    /**
     * Optional metadata for auditing and compliance
     */
    metadata?: Record<string, any>;
  }
  
  /**
   * Interface for scheduler scan event
   */
  export interface SchedulerScanEvent {
    /**
     * Timestamp of when the scan was triggered
     */
    scanTime: string;
    
    /**
     * Optional limit on how many plans to process in one batch
     */
    batchSize?: number;
  }
  
  /**
   * Interface for scheduler execution event
   */
  export interface SchedulerExecutionEvent {
    /**
     * User identifier
     */
    userId: string;
    
    /**
     * Plan identifier
     */
    planId: string;
    
    /**
     * Timestamp of when the execution was triggered
     */
    executionTime: string;
    
    /**
     * Unique execution identifier for deduplication
     */
    executionId: string;
    
    /**
     * Number of retry attempts (0 for initial attempt)
     */
    attemptCount: number;
  }
  
  /**
   * Interface for Bitcoin purchase result
   */
  export interface BitcoinPurchaseResult {
    /**
     * Success flag
     */
    success: boolean;
    
    /**
     * Transaction identifier from the exchange
     */
    exchangeTransactionId?: string;
    
    /**
     * Amount of bitcoin purchased
     */
    bitcoinAmount?: number;
    
    /**
     * Exchange rate at time of purchase (USD per BTC)
     */
    exchangeRate?: number;
    
    /**
     * Fees paid for the purchase (in USD)
     */
    fees?: number;
    
    /**
     * Error message if the purchase failed
     */
    errorMessage?: string;
    
    /**
     * Detailed error information for debugging
     */
    errorDetails?: Record<string, any>;
  }
  
  /**
   * Event types for EventBridge events
   */
  export enum EventType {
    PLAN_CREATED = 'PLAN_CREATED',
    PLAN_UPDATED = 'PLAN_UPDATED',
    PLAN_DELETED = 'PLAN_DELETED',
    EXECUTION_SCHEDULED = 'EXECUTION_SCHEDULED',
    EXECUTION_STARTED = 'EXECUTION_STARTED',
    EXECUTION_COMPLETED = 'EXECUTION_COMPLETED',
    EXECUTION_FAILED = 'EXECUTION_FAILED',
  }