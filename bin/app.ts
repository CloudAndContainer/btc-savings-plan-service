#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SchedulerStack } from '../lib/btc-savings-plan-service-stack';

/**
 * Main CDK app entry point for the Bitcoin Broker Savings Plan Scheduler
 * 
 * This deploys the scheduler service infrastructure for different environments
 * (development, staging, production).
 */
const app = new cdk.App();

// Development environment
new SchedulerStack(app, 'BitcoinBroker-SavingsPlanScheduler-Dev', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  stage: 'dev',
  enableTracing: false, // Disable tracing in dev to reduce costs
  scanIntervalMinutes: 15, // Scan less frequently in dev
  maxRetries: 3, // Fewer retries in dev
  description: 'Bitcoin Broker Savings Plan Scheduler (Development)',
});

// Staging environment
new SchedulerStack(app, 'BitcoinBroker-SavingsPlanScheduler-Staging', {
  env: { 
    account: process.env.CDK_STAGING_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_STAGING_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  stage: 'staging',
  enableTracing: true, // Enable tracing in staging for testing
  scanIntervalMinutes: 5, // Scan every 5 minutes in staging
  maxRetries: 3, // Standard retries in staging
  logRetentionDays: logs.RetentionDays.THREE_MONTHS,
  description: 'Bitcoin Broker Savings Plan Scheduler (Staging)',
});

// Production environment
new SchedulerStack(app, 'BitcoinBroker-SavingsPlanScheduler-Prod', {
  env: { 
    account: process.env.CDK_PROD_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_PROD_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  stage: 'prod',
  enableTracing: true, // Always enable tracing in production for debugging
  scanIntervalMinutes: 1, // Scan every minute in production for responsiveness
  maxRetries: 5, // More retries in production for resilience
  logRetentionDays: logs.RetentionDays.ONE_YEAR, // Longer retention for compliance
  description: 'Bitcoin Broker Savings Plan Scheduler (Production)',
});

app.synth();
