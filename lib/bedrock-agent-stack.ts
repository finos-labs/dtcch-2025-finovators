/**
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';

import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import {Construct} from 'constructs';

import { bedrock } from '@cdklabs/generative-ai-cdk-constructs';
import {NagSuppressions} from "cdk-nag";
import * as path from "path";
import { AgentActionGroup } from '@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AwsCustomResource, AwsCustomResourcePolicy, AwsSdkCall, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'

export class BedrockAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const s3CorsRule: s3.CorsRule = {
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      maxAge: 300,
    };

    const s3Bucket = new s3.Bucket(this, 'S3Bucket', {
      publicReadAccess: false,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      accessControl: s3.BucketAccessControl.PRIVATE,
      cors: [s3CorsRule]
    });
    const s3Deployment = new s3deploy.BucketDeployment(this, 'DeployFiles', {
      sources: [s3deploy.Source.asset('./web-assets')], // 'folder' contains your empty files at the right locations
      destinationBucket: s3Bucket,
      
    });
    NagSuppressions.addResourceSuppressions(s3Bucket, [
      {id: 'AwsSolutions-S1', reason: 'There is no need to enable access logging for cloudfront based bucket.'},
    
      {id: 'AwsSolutions-IAM4', reason: 'There is no need to enable access logging for cloudfront based bucket.'},
    
      {id: 'AwsSolutions-IAM5', reason: 'There is no need to enable access logging for cloudfront based bucket.'},
      {id: 'AwsSolutions-L1', reason: 'There is no need to enable access logging for cloudfront based bucket.'},
    ],true)
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');
    s3Bucket.grantRead(oai);

    const backendCloudfront = new cloudfront.CloudFrontWebDistribution(this, 'BackendCF', {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: s3Bucket,
            originAccessIdentity: oai,
          },
          behaviors: [{isDefaultBehavior: true}, { pathPattern: '/*', allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD }]

        },
      ],
      
    })
    const accesslogBucket = new s3.Bucket(this, 'AccessLogs', {
      enforceSSL: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    NagSuppressions.addResourceSuppressions(accesslogBucket, [
      {id: 'AwsSolutions-S1', reason: 'There is no need to enable access logging for the AccessLogs bucket.'},
    ])
    const docBucket = new s3.Bucket(this, 'DocBucket', {
      enforceSSL: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: accesslogBucket,
      serverAccessLogsPrefix: 'inputsAssetsBucketLogs/',
    });
    const kb = new bedrock.KnowledgeBase(this, 'KB', {
      embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
      instruction: 'Use this knowledge base to retrieve SOPs related to fraud ' +
        'It contains the steps for each fraud investigation',
    });
    const dataSource = new bedrock.WebCrawlerDataSource(this,'DataSource',{
      knowledgeBase:kb,
      sourceUrls: [`https://${backendCloudfront.distributionDomainName}`],
      chunkingStrategy: bedrock.ChunkingStrategy.NONE
    })

    // const dataSourcew = new bedrock.S3DataSource(this, 'DataSource', {
    //   bucket: docBucket,
    //   knowledgeBase: kb,
    //   dataSourceName: 'books',
    //   chunkingStrategy: bedrock.ChunkingStrategy.fixedSize({
    //     maxTokens: 500,
    //     overlapPercentage: 20
    //   }),
    // });

    const accountHolderInfoTable = new Table(this, 'account_holder_info', {
      partitionKey: {
        name: 'customerId',
        type: AttributeType.STRING
      },
      tableName: 'account_holder_info',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    const callTranscriptsTable = new Table(this, 'call_transcripts', {
      partitionKey: {
        name: 'customerId',
        type: AttributeType.STRING
      },
      tableName: 'call_transcripts',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    const locationActivityTable = new Table(this, 'location_activity', {
      partitionKey: {
        name: 'customerId',
        type: AttributeType.STRING
      },
      tableName: 'location_activity',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    const agent = new bedrock.Agent(this, 'Agent', {
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_3_5_SONNET_V1_0,
      instruction: 'You are a Fraud assistant responsible for identifying if a customer account is compromised. For each task, follow these steps: 1. Retrieve SOP Steps from Knowledge Base: 1.1 Query the knowledge base with the task description to retrieve the relevant SOP steps. 2. Perform the Actions Mentioned in the SOP Steps: 2.1 Execute each step in the order it is mentioned. 2.2 Output the findings after completing each step. 3. Analyze Findings: 3.1 Analyze the findings from each executed step. 4. Output Results: 4.1 Format the output in JSON with keys: "potentialFraud": ("true"/"false") "reason": (string) - provide only JSON structure as output and ensure the reason is concise 4.2 If any step indicates mismatch, mark it as potential fraud without using your own reasoning beyond the provided instructions. Exclude geo location for now as the tool is still getting tested Always ensure to query the knowledge base for each task and follow the steps exactly as outlined to maintain consistency and accuracy. Please follow below instructions only for fraud status update request, this is an exception to the standard SOP procedure Please call the api related to update fraud status using the account number and return status of whether it was successful or not ',
      knowledgeBases: [kb],
      userInputEnabled: true,
      shouldPrepareAgent:true
    });

    // const actionGroupFunction = new lambda_python.PythonFunction(this, 'ActionGroupFunction', {
    //   runtime: lambda.Runtime.PYTHON_3_12,
    //   entry: path.join(__dirname, '../lambda/action-group'),
    //   layers: [lambda.LayerVersion.fromLayerVersionArn(this, 'PowerToolsLayer', `arn:aws:lambda:${this.region}:017000801446:layer:AWSLambdaPowertoolsPythonV2:60`)],
    //   timeout:cdk.Duration.minutes(2)
    // });

    const actionGroupAccountHolderFunction = new lambda_python.PythonFunction(this, 'ActionGroupAccountHolderFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      entry: path.join(__dirname, '../lambda/action-group-account-holder'),
      timeout:cdk.Duration.minutes(2)
    });
      actionGroupAccountHolderFunction.addToRolePolicy(new iam.PolicyStatement({

        effect : iam.Effect.ALLOW,
        actions : [
          'dynamodb:Query',
        ],
        resources : [
          accountHolderInfoTable.tableArn,
        ],
    }))
    const actionGroupCallTranscriptsFunction = new lambda_python.PythonFunction(this, 'ActionGroupCallTranscriptsFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      entry: path.join(__dirname, '../lambda/action-group-call-transcripts'),
      timeout:cdk.Duration.minutes(2)
    });
    actionGroupCallTranscriptsFunction.addToRolePolicy(new iam.PolicyStatement({

      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:Query',
      ],
      resources: [
        callTranscriptsTable.tableArn,
      ],
    }))
    
    const actionGroupLocationActivityFunction = new lambda_python.PythonFunction(this, 'ActionGroupLocationActivityFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      entry: path.join(__dirname, '../lambda/action-group-location-activity'),
      timeout:cdk.Duration.minutes(2)
    });
    actionGroupLocationActivityFunction.addToRolePolicy(new iam.PolicyStatement({

      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:Query',
      ],
      resources: [
        locationActivityTable.tableArn,
      ],
    }))

    const actionGroupAccountHolder = new AgentActionGroup({
      name: 'action-group-account-holder',
      description: 'Use these functions to get information about the books in the library.',
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(actionGroupAccountHolderFunction),
      enabled: true,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, 'action-group-account-holder.json')),
    });

    const actionGroupCallTranscripts = new AgentActionGroup({
      name: 'action-group-call-transcripts',
      description: 'Use these functions to get information about the books in the library.',
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(actionGroupCallTranscriptsFunction),
      enabled: true,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, 'action-group-call-transcripts.json')),
    });

    const actionGroupLocationActivity = new AgentActionGroup({
      name: 'action-group-location-activity',
      description: 'Use these functions to get information about the books in the library.',
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(actionGroupLocationActivityFunction),
      enabled: true,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(path.join(__dirname, 'action-group-location-activity.json')),
    });

    agent.addActionGroup(actionGroupAccountHolder);
    agent.addActionGroup(actionGroupCallTranscripts);
    agent.addActionGroup(actionGroupLocationActivity);

    const agentAlias2 = new bedrock.AgentAlias(this, 'myalias6', {
      aliasName: 'my-agent-alias5',
      agent: agent,
      description: 'alias for my agent'
    });

    const lexHandlerFunction = new lambda_python.PythonFunction(this, 'LexHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      entry: path.join(__dirname, '../lambda/lex-handler'),
      timeout: cdk.Duration.minutes(2),
      environment:{
        'agent_id': agent.agentId,
        'agent_alias_id': agentAlias2.aliasId
      }
    });
    lexHandlerFunction.addToRolePolicy(new iam.PolicyStatement({

      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
      ],
      resources: [
        agentAlias2.aliasArn,
      ],
    }))

    // Add NAG suppression for the Agent's role policy
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.path}/Agent/Role/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The Agent requires permissions to invoke the action group Lambda function',
          appliesTo: ['Resource::<ActionGroupAccountHolderFunction1AA53538.Arn>:*'],
        },
                {
          id: 'AwsSolutions-IAM5',
          reason: 'The Agent requires permissions to invoke the action group Lambda function',
          appliesTo: ['Resource::<ActionGroupLocationActivityFunction48C1DDD3.Arn>:*'],
        },
                {
          id: 'AwsSolutions-IAM5',
          reason: 'The Agent requires permissions to invoke the action group Lambda function',
          appliesTo: ['Resource::<ActionGroupCallTranscriptsFunction97EE3707.Arn>:*'],
        },
      ],
      true
    );
  
    new cdk.CfnOutput(this, 'AgentId', {value: agent.agentId});
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {value: kb.knowledgeBaseId});
    new cdk.CfnOutput(this, 'DataSourceId', {value: dataSource.dataSourceId});
    new cdk.CfnOutput(this, 'DocumentBucket', {value: docBucket.bucketName});

    NagSuppressions.addResourceSuppressions(
      actionGroupAccountHolderFunction,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'ActionGroup Lambda uses the AWSLambdaBasicExecutionRole AWS Managed Policy.',
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using Python 3.12 as the latest runtime version for Lambda.',
        }
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      actionGroupCallTranscriptsFunction,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'ActionGroup Lambda uses the AWSLambdaBasicExecutionRole AWS Managed Policy.',
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using Python 3.12 as the latest runtime version for Lambda.',
        }
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      actionGroupLocationActivityFunction,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'ActionGroup Lambda uses the AWSLambdaBasicExecutionRole AWS Managed Policy.',
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using Python 3.12 as the latest runtime version for Lambda.',
        }
      ],
      true,
    );
    NagSuppressions.addResourceSuppressions(
      lexHandlerFunction,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'ActionGroup Lambda uses the AWSLambdaBasicExecutionRole AWS Managed Policy.',
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using Python 3.12 as the latest runtime version for Lambda.',
        }
      ],
      true,
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.path}/Agent/Role/DefaultPolicy`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The Lambda function requires broad permissions for logging and invocation.',
          appliesTo: [
            'Action::lambda:InvokeFunction',
            'Action::logs:*'
          ],
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.node.path}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'CDK CustomResource LogRetention Lambda uses the AWSLambdaBasicExecutionRole AWS Managed Policy. Managed by CDK.',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'CDK CustomResource LogRetention Lambda uses a wildcard to manage log streams created at runtime. Managed by CDK.',
        },
      ],
      true,
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,`/BedrockAgentStack/BackendCF/CFDistribution`,
      [
        {
          id: 'AwsSolutions-CFR4',
          reason: 'this is just a test cloudfront which uses a default cert',
        },
        {
          id: 'AwsSolutions-CFR7',
          reason: 'cloudfront uses origin access identity and s3 is private',
        },
        {
          id: 'AwsSolutions-CFR3',
          reason: 'cloudfront does not need access logging as it is just for demo',
        }
        
      ],
      true
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,`/BedrockAgentStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'this is just a test cloudfront which uses a default cert',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'cloudfront uses origin access identity and s3 is private',
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'cloudfront does not need access logging as it is just for demo',
        }
        
      ],
      true
    );

    
    

    class CdkCallCustomResourceConstruct extends Construct {

      constructor(scope: Construct, id: string) {
        super(scope, id);
        this.insertRecord(1,'call_transcripts',callTranscriptsTable.tableArn,{
          customerId: {S:'98b1b330-f081-706b-62e4-5392a9cd880f'},
          transcripts: {L:[{M:{"transcript":{S:"Agent: Thank you for calling [Bank Name]. This is [Agent's Name]. How may I assist you today? Customer: Hi, I'd like to open a savings account with your bank.  Agent: Absolutely, I'd be happy to help you with that. Do you currently have any accounts with us?  Customer: No, this would be my first account with your bank.    Agent: Okay, not a problem. To get started, I'll need to collect some personal information from you. Can you provide me with your full legal name, date of birth, and social security number?    Customer: Sure, my name is [Customer's Name], my date of birth is [Date of Birth], and my social security number is [Social Security Number].    Agent: Thank you for providing that information. Now, what type of savings account would you like to open? We have a few different options with varying interest rates and minimum balance requirements.    Customer: I'm not sure, what would you recommend for someone just starting to build their savings?    Agent: For a beginner savings account, I would recommend our Basic Savings account. It has a competitive interest rate and no minimum balance requirement to open or maintain the account.    Customer: That sounds good. What are the interest rate and any applicable fees for that account?    Agent: The current interest rate for the Basic Savings account is 0.75% APY. There are no monthly maintenance fees, and you'll have free unlimited transactions.    Customer: Okay, that seems reasonable. How much do I need to open the account?    Agent: The minimum opening deposit for the Basic Savings account is $25.    Customer: Great, I can do that. What's the process from here?    Agent: Since you don't have any existing accounts with us, I'll need to verify your identity. Can you provide me with a valid government-issued photo ID, such as a driver's license or passport?    Customer: Yes, I have my driver's license here. Should I read the number to you?    Agent: No need to read the number, but I will need you to describe the appearance of the ID, such as the issue and expiration dates, and your physical description like height, weight, and eye color.    Customer: Okay, got it. [Customer describes their driver's license details and physical appearance].    Agent: Thank you, that matches the information I have on file. To complete the account opening process, I'll need your initial deposit amount, and we can set up your online banking access as well.    Customer: Sounds good. I'll start with a $100 deposit, and yes, please set up online banking for me.    Agent: Excellent. I've opened your new Basic Savings account, and your initial deposit of $100 has been processed. Your account number is [Account Number]. I've also set up your online banking profile with a temporary password that you can change after your first login.    Customer: Perfect, thank you for your help!    Agent: You're very welcome. Is there anything else I can assist you with today regarding your new savings account or any other banking needs?    Customer: No, that covers everything for now. Thank you again for your help in opening my account.    Agent: It was my pleasure assisting you today. Enjoy your new savings account, and don't hesitate to contact us if you have any other questions or needs in the future.    Customer: Will do, thanks again! Goodbye.    Agent: Goodbye!"}}}]}
        })
        this.insertRecord(2,'call_transcripts',callTranscriptsTable.tableArn,{
          customerId: {S:'18f1f330-3051-7089-8785-5813721b9e5e'},
          transcripts: {L:[{M:{"transcript":{S:"Customer: Hi, I need to report a suspicious transaction on my account.Agent: Certainly, sir/ma'am. I'll be happy to assist you with that. Could you please provide me with your account number?Customer: Yes, it's [account number].Agent: Thank you. Let me pull up your account details. Could you briefly explain the nature of the suspicious transaction?Customer: Well, I was checking my account statement, and there's a charge for $975 from a company called XYZ Enterprises that I don't recognize.Agent: I see. That does seem suspicious. Can you confirm if you have made any purchases from this company recently?Customer: No, absolutely not. I have no idea what XYZ Enterprises is.Agent: Understood. yes, it look fraud, Let me investigate this further and get back. Have a wonderful rest of your day.Customer: You too. Goodbye."}}}]}
        })
        this.insertRecord(3,'call_transcripts',callTranscriptsTable.tableArn,{
          customerId: {S:'a861b360-1071-70f5-44cf-d46bffc99466'},
          transcripts: {L:[{M:{"transcript":{S:"Agent: Thank you for calling [Bank Name]. This is [Agent's Name]. How may I assist you today? Customer: Hi, I'd like to open a savings account with your bank.  Agent: Absolutely, I'd be happy to help you with that. Do you currently have any accounts with us?  Customer: No, this would be my first account with your bank.    Agent: Okay, not a problem. To get started, I'll need to collect some personal information from you. Can you provide me with your full legal name, date of birth, and social security number?    Customer: Sure, my name is [Customer's Name], my date of birth is [Date of Birth], and my social security number is [Social Security Number].    Agent: Thank you for providing that information. Now, what type of savings account would you like to open? We have a few different options with varying interest rates and minimum balance requirements.    Customer: I'm not sure, what would you recommend for someone just starting to build their savings?    Agent: For a beginner savings account, I would recommend our Basic Savings account. It has a competitive interest rate and no minimum balance requirement to open or maintain the account.    Customer: That sounds good. What are the interest rate and any applicable fees for that account?    Agent: The current interest rate for the Basic Savings account is 0.75% APY. There are no monthly maintenance fees, and you'll have free unlimited transactions.    Customer: Okay, that seems reasonable. How much do I need to open the account?    Agent: The minimum opening deposit for the Basic Savings account is $25.    Customer: Great, I can do that. What's the process from here?    Agent: Since you don't have any existing accounts with us, I'll need to verify your identity. Can you provide me with a valid government-issued photo ID, such as a driver's license or passport?    Customer: Yes, I have my driver's license here. Should I read the number to you?    Agent: No need to read the number, but I will need you to describe the appearance of the ID, such as the issue and expiration dates, and your physical description like height, weight, and eye color.    Customer: Okay, got it. [Customer describes their driver's license details and physical appearance].    Agent: Thank you, that matches the information I have on file. To complete the account opening process, I'll need your initial deposit amount, and we can set up your online banking access as well.    Customer: Sounds good. I'll start with a $100 deposit, and yes, please set up online banking for me.    Agent: Excellent. I've opened your new Basic Savings account, and your initial deposit of $100 has been processed. Your account number is [Account Number]. I've also set up your online banking profile with a temporary password that you can change after your first login.    Customer: Perfect, thank you for your help!    Agent: You're very welcome. Is there anything else I can assist you with today regarding your new savings account or any other banking needs?    Customer: No, that covers everything for now. Thank you again for your help in opening my account.    Agent: It was my pleasure assisting you today. Enjoy your new savings account, and don't hesitate to contact us if you have any other questions or needs in the future.    Customer: Will do, thanks again! Goodbye.    Agent: Goodbye!"}}}]}
        })
        this.insertRecord(1,'location_activity', locationActivityTable.tableArn, {
          "customerId": {
            "S": "98b1b330-f081-706b-62e4-5392a9cd880f"
          },
          "AccountActivityLogs": {
            "L": []
          },
          "GeoLocationLogs": {
            "L": [
              {
                "M": {
                  "Location": {
                    "S": "New York, USA"
                  },
                  "Timestamp": {
                    "S": "2023-07-20T10:00:00Z"
                  }
                }
              },
              {
                "M": {
                  "Location": {
                    "S": "New York, USA"
                  },
                  "Timestamp": {
                    "S": "2023-07-21T14:00:00Z"
                  }
                }
              }
            ]
          }
        })
        this.insertRecord(2,'location_activity', locationActivityTable.tableArn, {
          "customerId": {
            "S": "18f1f330-3051-7089-8785-5813721b9e5e"
          },
          "AccountActivityLogs": {
            "L": [
              {
                "M": {
                  "ActivityType": {
                    "S": "FailedLogin"
                  },
                  "Details": {
                    "S": "0 failed login attempts"
                  },
                  "Timestamp": {
                    "S": "2023-07-19T08:00:00Z"
                  }
                }
              },
              {
                "M": {
                  "ActivityType": {
                    "S": "PasswordChange"
                  },
                  "Details": {
                    "S": "Password changed successfully"
                  },
                  "Timestamp": {
                    "S": "2023-07-21T12:00:00Z"
                  }
                }
              }
            ]
          },
          "GeoLocationLogs": {
            "L": [
              {
                "M": {
                  "Location": {
                    "S": "New York, USA"
                  },
                  "Timestamp": {
                    "S": "2023-07-20T10:00:00Z"
                  }
                }
              },
              {
                "M": {
                  "Location": {
                    "S": "New York, USA"
                  },
                  "Timestamp": {
                    "S": "2023-07-21T14:00:00Z"
                  }
                }
              }
            ]
          }
        })
        this.insertRecord(3,'location_activity', locationActivityTable.tableArn, {
          "customerId": {
            "S": "a861b360-1071-70f5-44cf-d46bffc99466"
          },
          "AccountActivityLogs": {
            "L": [
              {
                "M": {
                  "ActivityType": {
                    "S": "FailedLogin"
                  },
                  "Details": {
                    "S": "0 failed login attempts"
                  },
                  "Timestamp": {
                    "S": "2023-07-19T08:00:00Z"
                  }
                }
              },
              {
                "M": {
                  "ActivityType": {
                    "S": "PasswordChange"
                  },
                  "Details": {
                    "S": "Password changed successfully"
                  },
                  "Timestamp": {
                    "S": "2023-07-21T12:00:00Z"
                  }
                }
              }
            ]
          },
          "GeoLocationLogs": {
            "L": [
              {
                "M": {
                  "Location": {
                    "S": "New York, USA"
                  },
                  "Timestamp": {
                    "S": "2023-07-20T10:00:00Z"
                  }
                }
              },
              {
                "M": {
                  "Location": {
                    "S": "London, UK"
                  },
                  "Timestamp": {
                    "S": "2023-07-21T14:00:00Z"
                  }
                }
              }
            ]
          }
        })
        this.insertRecord(1,'account_holder_info',accountHolderInfoTable.tableArn,{
          "customerId": {
            "S": "98b1b330-f081-706b-62e4-5392a9cd880f"
          },
          "email": {
            "S": "jim.smith@gmail.com"
          },
          "name": {
            "S": "jim Smith"
          },
          "phone": {
            "S": "602-110-1003"
          },
          "spousename": {
            "S": "Mary Smith"
          },
          "zipcode": {
            "S": "85308"
          }
        })
        this.insertRecord(2,'account_holder_info', accountHolderInfoTable.tableArn, {
          "customerId": {
            "S": "18f1f330-3051-7089-8785-5813721b9e5e"
          },
          "email": {
            "S": "james@gmail.com"
          },
          "name": {
            "S": "James Smith"
          },
          "phone": {
            "S": "4801101003"
          },
          "spousename": {
            "S": "Mary Smith"
          },
          "zipcode": {
            "S": "85308"
          }
        })
        this.insertRecord(3,'account_holder_info', accountHolderInfoTable.tableArn, {
          "customerId": {
            "S": "a861b360-1071-70f5-44cf-d46bffc99466"
          },
          "email": {
            "S": "johnrocks@gmail.com"
          },
          "name": {
            "S": "John Smith"
          },
          "phone": {
            "S": "400-110-1002"
          },
          "spousename": {
            "S": "Mary Smith"
          },
          "zipcode": {
            "S": "85308"
          }
        })
      }
      

      private insertRecord(seqno:number, tableName: string,tableArn: string, item: any) {
        const awsSdkCall: AwsSdkCall = {
          service: 'DynamoDB',
          action: 'putItem',
          physicalResourceId: PhysicalResourceId.of(tableName + '_insert'+seqno),
          parameters: {
            TableName: tableName,
            Item: item
          }
        }
        const customResource = new AwsCustomResource(this, tableName + seqno, {
              onCreate: awsSdkCall,
              onUpdate: awsSdkCall,
              logRetention: RetentionDays.ONE_WEEK,
              policy: AwsCustomResourcePolicy.fromStatements([
                new PolicyStatement({
                  sid: 'DynamoWriteAccess',
                  effect: Effect.ALLOW,
                  actions: ['dynamodb:PutItem'],
                  resources: [tableArn],
                })
              ]),
              timeout: cdk.Duration.minutes(5)
            }
        );
      }
    }
    const ddbWriteItems = new CdkCallCustomResourceConstruct(this,'seed-data')
    NagSuppressions.addResourceSuppressionsByPath(
      this,'/BedrockAgentStack/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource',
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'this is just a test cloudfront which uses a default cert',
        }
        
      ],
      true
    );
  } 
}
