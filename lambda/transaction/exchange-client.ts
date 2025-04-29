// lambda/transaction/exchange-client.ts
import axios from 'axios';
type AxiosRequestConfig = any;
type AxiosInstance = any;
import { createHmac } from 'crypto';
import { BitcoinPurchaseResult } from '../scheduler/types';
import { SecretsManager } from 'aws-sdk';

/**
 * Bitcoin exchange API configuration
 */
interface ExchangeConfig {
  /**
   * API key for authentication
   */
  apiKey: string;
  
  /**
   * API secret for signing requests
   */
  apiSecret: string;
  
  /**
   * Base URL for the exchange API
   */
  baseUrl: string;
  
  /**
   * Optional timeout in milliseconds (default: 5000)
   */
  timeout?: number;
  
  /**
   * Whether to use the sandbox/test environment
   */
  useSandbox?: boolean;
}

/**
 * Bitcoin exchange purchase request parameters
 */
interface PurchaseRequest {
  /**
   * User identifier
   */
  userId: string;
  
  /**
   * Amount to purchase in USD
   */
  amount: number;
  
  /**
   * Source of funds (e.g., bank account, credit card)
   */
  sourceOfFunds: string;
  
  /**
   * Client-generated request ID for idempotent requests
   */
  clientRequestId: string;
}

/**
 * Client for interacting with Bitcoin exchange API
 * 
 * This class handles the secure communication with the exchange API,
 * including authentication, signing, and error handling according to
 * regulatory requirements.
 */
export class BitcoinExchangeClient {
  private readonly config: ExchangeConfig;
  private readonly axiosClient: AxiosInstance;
  private readonly secretsManager: SecretsManager;
  
  /**
   * Create a new instance of the Bitcoin exchange client
   * 
   * @param config - Exchange API configuration
   */
  constructor(config: ExchangeConfig) {
    this.config = config;
    this.secretsManager = new SecretsManager({ apiVersion: '2017-10-17' });
    
    // Create axios client with default configuration
    this.axiosClient = axios.create({
      baseURL: config.useSandbox ? 
        `${config.baseUrl}/sandbox` : config.baseUrl,
      timeout: config.timeout || 5000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Bitcoin-Broker-Scheduler/1.0',
      },
    });
    
    // Add request interceptor for authentication and signing
    this.axiosClient.interceptors.request.use(this.signRequest.bind(this));
  }
  
  /**
   * Static factory method to create a client from secrets manager
   * 
   * @param secretId - Secret ID in AWS Secrets Manager
   * @param stage - Deployment stage (dev, staging, prod)
   * @returns Promise resolving to BitcoinExchangeClient instance
   */
  static async createFromSecrets(secretId: string, stage: string): Promise<BitcoinExchangeClient> {
    const secretsManager = new SecretsManager();
    
    try {
      const secretResponse = await secretsManager.getSecretValue({
        SecretId: secretId,
      }).promise();
      
      if (!secretResponse.SecretString) {
        throw new Error('Secret value is empty');
      }
      
      const config = JSON.parse(secretResponse.SecretString) as ExchangeConfig;
      
      // Use sandbox for non-production environments
      config.useSandbox = stage !== 'prod';
      
      return new BitcoinExchangeClient(config);
    } catch (error) {
      console.error('Error retrieving exchange API credentials:', error);
      
      if (stage === 'dev') {
        console.warn('Using demo credentials for development environment');
        // Return a demo client for development
        return new BitcoinExchangeClient({
          apiKey: 'demo-key',
          apiSecret: 'demo-secret',
          baseUrl: 'https://api.example.com/exchange',
          useSandbox: true,
        });
      }
      
      throw error;
    }
  }
  
  /**
   * Sign a request with the API key and secret
   * 
   * @param config - Axios request configuration
   * @returns Signed request configuration
   */
  private signRequest(config: AxiosRequestConfig): AxiosRequestConfig {
    const timestamp = Date.now().toString();
    const method = config.method?.toUpperCase() || 'GET';
    const path = config.url || '';
    const body = config.data ? JSON.stringify(config.data) : '';
    
    // Create signature payload
    const payload = `${timestamp}${method}${path}${body}`;
    
    // Sign payload with HMAC SHA256
    const signature = createHmac('sha256', this.config.apiSecret)
      .update(payload)
      .digest('hex');
    
    // Add authentication headers
    config.headers = {
      ...config.headers,
      'X-API-Key': this.config.apiKey,
      'X-API-Timestamp': timestamp,
      'X-API-Signature': signature,
    };
    
    return config;
  }
  
  /**
   * Execute a bitcoin purchase
   * 
   * @param request - Purchase request parameters
   * @returns Promise resolving to purchase result
   */
  async purchaseBitcoin(request: PurchaseRequest): Promise<BitcoinPurchaseResult> {
    try {
      console.log('Executing bitcoin purchase', {
        userId: request.userId,
        amount: request.amount,
        clientRequestId: request.clientRequestId,
      });
      
      // Add audit information
      const requestData = {
        ...request,
        timestamp: new Date().toISOString(),
      };

      // In a real implementation, this would call the actual exchange API
      // For this example, we'll simulate a response
      
      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
      
      // Simulate 5% failure rate for testing
      if (Math.random() < 0.05) {
        throw new Error('Exchange API temporary error');
      }
      
      // Simulate Bitcoin price between $60,000 and $70,000
      const exchangeRate = 60000 + Math.random() * 10000;
      const bitcoinAmount = request.amount / exchangeRate;
      const fees = request.amount * 0.01; // 1% fee
      
      return {
        success: true,
        exchangeTransactionId: `tx-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        bitcoinAmount,
        exchangeRate,
        fees,
      };
    } catch (error: any) {
      console.error('Bitcoin purchase failed:', error);

      // Create detailed error response
      const errorResult: BitcoinPurchaseResult = {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
        errorDetails: {
          timestamp: new Date().toISOString(),
          requestId: request.clientRequestId,
        },
      };

      // Add additional error details if available
      if ((axios as any).isAxiosError && (axios as any).isAxiosError(error) && error.response) {
        errorResult.errorDetails = {
          ...errorResult.errorDetails,
          statusCode: error.response.status,
          statusText: error.response.statusText,
          responseData: error.response.data,
        };
      }

      return errorResult;
    }
  }
}
