# Amazon Bedrock Agent and Custom Knowledge Base

## Overview

A chat assistant designed for helping demonstrate how bedrock agents and generative AI can help in automating and improving on fraud investigation workflows
## Folder Structure

The key folders are:

```
samples/bedrock-agent-stack
│
├── bin
│   └── bedrock-agent.ts                      # CDK app
├── lib                                       # CDK Stacks
│   ├── bedrock-agent-stack.ts                # Stack deploying the S3 bucket, Bedrock Agent, Action Group, and Knowledge Base
├── lambda                                    # Lambda functions
│   └── action-group                          # Action Group functions
```

## Getting started

### Prerequisites

- An AWS account. We recommend you deploy this solution in a new account.
- [AWS CLI](https://aws.amazon.com/cli/): configure your credentials

```
aws configure --profile [your-profile] 
AWS Access Key ID [None]: xxxxxx
AWS Secret Access Key [None]:yyyyyyyyyy
Default region name [None]: us-east-1 
Default output format [None]: json
```

- Node.js: v18.12.1
- [AWS CDK](https://github.com/aws/aws-cdk/releases/tag/v2.143.0): 2.143.0
- jq: jq-1.6

### Deploy the solution

This project is built using the [AWS Cloud Development Kit (CDK)](https://aws.amazon.com/cdk/). See [Getting Started With the AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) for additional details and prerequisites.

1. Clone this repository.
    ```shell
    git clone <this>
    ```

2. Enter the code sample backend directory.
    ```shell
    cd samples/bedrock-agent
    ```

3. Install packages
   ```shell
   npm install
   ```

4. Boostrap AWS CDK resources on the AWS account.
    ```shell
    cdk bootstrap aws://ACCOUNT_ID/REGION
    ```

5. Enable Access to Amazon Bedrock Models
> You must explicitly enable access to models before they can be used with the Amazon Bedrock service. Please follow these steps in the [Amazon Bedrock User Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) to enable access to the models (```Anthropic::Claude```):.

6. Deploy the sample in your account. 
    ```shell
    $ cdk deploy --all
    ```
The command above will deploy one stack in your account. With the default configuration of this sample, the observed deployment time was ~381 seconds (6.5 minutes).

To protect you against unintended changes that affect your security posture, the AWS CDK Toolkit prompts you to approve security-related changes before deploying them. You will need to answer yes to get the stack deployed.

Outputs:
```
BedrockAgentStack.AgentId = <AgentID>
BedrockAgentStack.DataSourceId = <DataSourceID>
BedrockAgentStack.DocumentBucket = <DocBucket>
BedrockAgentStack.KnowledgeBaseId = <KBID>
```

6. Deploy Lex UI basic donfig.
    ```
    ](https://github.com/aws-samples/aws-lex-web-ui)
    ```
7. Assign the default intent in the lex bot to the lambda lex handler
### Test

Navigate to the [Bedrock Agents console] in your region and find your new agent.

Ask some questions. 

#### questions

* can you run fraud sop for customer id a861b360-1071-70f5-44cf-d46bffc99466?

* can you run fraud sop for customer id 18f1f330-3051-7089-8785-5813721b9e5e?

* can you run fraud sop for customer id 98b1b330-f081-706b-62e4-5392a9cd880f?


**The demo wwalks you on how the bedrock agents configured with the different tools can help automate a fraud investigation using SOP**

## Clean up

Do not forget to delete the stack to avoid unexpected charges.

First make sure to remove all data from the Amazon Simple Storage Service (Amazon S3) Bucket.

```shell
    $ cdk destroy
```

Delete all the associated logs created by the different services in Amazon CloudWatch logs

# Content Security Legal Disclaimer
The sample code; software libraries; command line tools; proofs of concept; templates; or other related technology (including any of the foregoing that are provided by our personnel) is provided to you as AWS Content under the AWS Customer Agreement, or the relevant written agreement between you and AWS (whichever applies). You should not use this AWS Content in your production accounts, or on production or other critical data. You are responsible for testing, securing, and optimizing the AWS Content, such as sample code, as appropriate for production grade use based on your specific quality control practices and standards. Deploying AWS Content may incur AWS charges for creating or using AWS chargeable resources, such as running Amazon EC2 instances or using Amazon S3 storage.

# Operational Metrics Collection
This solution collects anonymous operational metrics to help AWS improve the quality and features of the solution. Data collection is subject to the AWS Privacy Policy (https://aws.amazon.com/privacy/). To opt out of this feature, simply remove the tag(s) starting with “uksb-” or “SO” from the description(s) in any CloudFormation templates or CDK TemplateOptions.

