"""
This sample demonstrates an implementation of the Lex Code Hook Interface
in order to serve a sample bot which manages orders for flowers.
Bot, Intent, and Slot models which are compatible with this sample can be found in the Lex Console
as part of the 'OrderFlowers' template.

For instructions on how to set up and test this bot, as well as additional samples,
visit the Lex Getting Started documentation http://docs.aws.amazon.com/lex/latest/dg/getting-started.html.
"""
import time
import os
import logging
import boto3
import time
from botocore.config import Config

config = Config(read_timeout=1000)
logger = logging.getLogger()
logger.setLevel(logging.DEBUG)
region_name = os.environ['AWS_REGION']
agent_id =os.environ['agent_id']
agent_alias_id = os.environ['agent_alias_id']
bedrock_agent_runtime_client = boto3.client("bedrock-agent-runtime", region_name=region_name,
                      config=config)

""" --- Helpers to build responses which match the structure of the necessary dialog actions --- """




def close(session_attributes, intent,  requestMsg, fulfillment_state, message):
    print(session_attributes);
    intent['state']='Fulfilled'
    if 'chat' in session_attributes:
        chat = session_attributes['chat'] +' member:' + requestMsg + ' Assistant:' + message
    else:
        chat =' member:' + requestMsg + ' Assistant:' + message
    session_attributes['chat'] = chat
    response = { 'sessionState': {
        'sessionAttributes': session_attributes,
        'dialogAction': {
            'type': 'Close',
        
        
        },
        'intent': intent,
        },
            'messages': [{'contentType': 'PlainText', 'content': message}]
        
    }

    return response







def handle_fraud(intent_request):
    
    
    requestMsg = intent_request['inputTranscript']
    
    enable_trace:bool = False
    end_session:bool = False
    
    # old agent_alias_id ="XZQCUYM2CH"
    session_id=intent_request['sessionId']
    # invoke the agent API
    agentResponse = bedrock_agent_runtime_client.invoke_agent(
    inputText=requestMsg,
    agentId=agent_id,
    agentAliasId=agent_alias_id, 
    sessionId=session_id,
    enableTrace=enable_trace, 
    endSession= end_session
    )
    print(agentResponse)
    event_stream = agentResponse['completion']
    print(event_stream)
    try:
        for event in event_stream:
            print(event)
            if 'chunk' in event:
                data = event['chunk']['bytes']
                logger.info(f"Final answer ->\n{data.decode('utf8')}")
                agent_answer = data.decode('utf8')
                end_event_received = True
                # End event indicates that the request finished successfully
            elif 'trace' in event:
                logger.info(json.dumps(event['trace'], indent=2))
            else:
                raise Exception("unexpected event.", event)
    except Exception as e:
        raise Exception("unexpected event.", e)

    return close(intent_request['sessionState']['sessionAttributes'],
                 intent_request['sessionState']['intent'],
                 requestMsg,
                 'Fulfilled',
                 agent_answer)
                 
                 

def dispatch(intent_request):
    """
    Called when the user specifies an intent for this bot.
    """
    return handle_fraud(intent_request)    
        

    raise Exception('Intent with name ' + intent_name + ' not supported')


""" --- Main handler --- """


def lambda_handler(event, context):
    """
    Route the incoming request based on intent.
    The JSON body of the request is provided in the event slot.
    """
    # By default, treat the user request as coming from the America/New_York time zone.
    os.environ['TZ'] = 'America/New_York'
    time.tzset()
    logger.debug('event.bot.name={}'.format(event['bot']['name']))

    return dispatch(event)
