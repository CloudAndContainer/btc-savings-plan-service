# BTC Savings Plan Service

A production-grade AWS CDK (TypeScript) project for managing automated Bitcoin savings plans. This project provisions AWS infrastructure and Lambda functions to schedule, execute, and manage recurring Bitcoin purchases and related transactions.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup & Installation](#setup--installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Directory Structure](#directory-structure)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

---

## Project Overview

BTC Savings Plan Service automates the process of scheduling and executing Bitcoin purchases on a recurring basis. It leverages AWS Lambda, SQS, and other AWS services, orchestrated using AWS CDK.

---

## Architecture

- **AWS CDK (TypeScript):** Infrastructure as code for AWS resources.
- **Lambda Functions:** Core business logic for scheduling and executing transactions.
- **SQS Dead Letter Queues:** For failed transaction handling.
- **Configurable Scheduling:** Supports custom intervals for Bitcoin purchases.

See the `architecture/` directory for diagrams, `docs/` directory for design documents, `output/`directory for the deployed stack and `.github/workflows` directory for CI/CD implementation. 

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [AWS CLI](https://aws.amazon.com/cli/) (configured with appropriate credentials)
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) (v2+)

---

## Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd btc-savings-plan-service
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure AWS credentials:**
   - Ensure your AWS CLI is configured (`aws configure`).
   - The CDK will use these credentials for deployment.

---

## Configuration

- **Secrets & Environment Variables:**
  - All sensitive configuration (API keys, secrets) should be provided via environment variables or AWS Secrets Manager.
  - Do NOT store secrets in the repository.
  - Update Lambda environment variables in the CDK stack as needed.

---

## Deployment

1. **Bootstrap your AWS environment (if not already done):**
   ```bash
   npx cdk bootstrap
   ```

2. **Deploy the stack:**
   ```bash
   npx cdk deploy
   ```

3. **Other useful CDK commands:**
   - `npx cdk synth` – Synthesize the CloudFormation template.
   - `npx cdk diff` – Compare deployed stack with local changes.

---

## Directory Structure

```
btc-savings-plan-service/
├── architecture/        # Architecture diagrams
├── bin/                 # CDK app entry point
├── config/              # Configuration files (no secrets)
├── docs/                # Design and migration docs
├── output/              # Deployed stack
├── lambda/              # Lambda function source code
│   ├── scheduler/
│   └── transaction/
├── lib/                 # CDK stack and constructs
├── .gitignore
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development

- **Build TypeScript:**
  ```bash
  npm run build
  ```
- **Watch for changes:**
  ```bash
  npm run watch
  ```
