import os
import io
import re
import json
import time
from datetime import timedelta, date
import boto3
import base64
import random
import string
import decimal
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.conditions import Attr

# DynamoDB boto3 resource and variable
dynamodb = boto3.resource('dynamodb',region_name=os.environ['AWS_REGION'])
existing_fraud_table_name = 'account_holder_info'

# SNS boto3 clients and variables
def get_named_parameter(event, name):
    return next(item for item in event['parameters'] if item['name'] == name)['value']
    

def get_account_holder_info(event):
    
    print("Getting Account Holder")
    customerId = get_named_parameter(event, 'customerId')
    
    print("customerId: " + str(customerId))
    transaction_table = dynamodb.Table(existing_fraud_table_name)
    
    attributes = transaction_table.query(
        TableName='account_holder_info',
        KeyConditionExpression=Key('customerId').eq(customerId)
    )
    
    if 'Items' in attributes and len(attributes['Items']) >= 1:
        attributes = attributes['Items'][0]
        print (attributes)
        return {
            "response": attributes 
        }
    return {
        "response": {}
    }

    
    
 
def handler(event, context):
    response_code = 200
    action_group = event['actionGroup']
    api_path = event['apiPath']
    
    # API path routing
    
    if api_path == '/get-account-holder/{customerId}':
        body = get_account_holder_info(event)
    else:
        response_code = 400
        body = {"{}::{} is not a valid api, try another one.".format(action_group, api_path)}
    response_body = {
        'application/json': {
            'body': body
        }
    }
    
    # Bedrock action group response format
    action_response = {
        "messageVersion": "1.0",
        "response": {
            'actionGroup': action_group,
            'apiPath': api_path,
            'httpMethod': event['httpMethod'],
            'httpStatusCode': response_code,
            'responseBody': response_body
        }
    }
 
    return action_response