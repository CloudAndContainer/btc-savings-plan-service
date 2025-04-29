#!/bin/bash
# Script to load environment variables for LocalStack (for Bash/Git Bash/Linux/Mac)

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    exit 1
fi

# Load variables from .env file
export $(grep -v '^#' .env | xargs)

# Confirm variables are set
echo "✅ LocalStack environment variables loaded successfully!"
echo "AWS Endpoint: $AWS_ENDPOINT"
echo "Region: $AWS_DEFAULT_REGION"
echo "Stack Name: $STACK_NAME"
echo "Stage: $STAGE"

# Setup AWS CLI profile for LocalStack if needed
aws configure set aws_access_key_id test --profile localstack
aws configure set aws_secret_access_key test --profile localstack
aws configure set region $AWS_DEFAULT_REGION --profile localstack
aws configure set output json --profile localstack
echo "✅ AWS CLI profile 'localstack' configured"

echo ""
echo "You can now run CDK commands against LocalStack, for example:"
echo "npx cdk deploy --context @aws-cdk/core:bootstrapQualifier=localstack"