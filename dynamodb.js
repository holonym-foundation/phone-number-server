var AWS = require('aws-sdk');
AWS.config.update({region:'us-east-2'});
var ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

// Helper function to get a phone number from the db
const getNumberParams = (value) => ({
	TableName: 'phone-numbers',
	Key: {'phoneNumber':{S:`${value}`}}
})

// Helper function to insert a phone number into  the db
const putNumberParams = (value) => ({
        TableName: 'phone-numbers',
        Item: {'phoneNumber':{S:`${value}`}}
})

// Returns true if number exists, false otherwise
const numberExists = (number, callback) => ddb.getItem(getNumberParams(number), (err,data)=>callback(err, data && "Item" in data))

// Adds number to the db
const addNumber = (number) => ddb.putItem(putNumberParams(number), (err)=>{if(err) throw 'Error storing number'})

/**
 * `status` is a reserved keyword in DynamoDB, so we name it `sessionStatus`.
 */
const putPhoneSession = (id, sigDigest, sessionStatus, chainId, txHash, numAttempts, refundTxHash) => {
    const params = {
        TableName: 'phone-sessions',
        Item: {
            'id': { S: `${id}` },
            'sigDigest': { S: `${sigDigest}` },
            'sessionStatus': { S: `${sessionStatus}` },
            ...(chainId ? { 'chainId': { N: `${chainId}` } } : {}),
            ...(txHash ? { 'txHash': { S: `${txHash}` } } : {}),
            'numAttempts': { N: `${numAttempts}` },
            ...(refundTxHash ? { 'refundTxHash': { S: `${refundTxHash}` } } : {})
        }
    }
    return ddb.putItem(params).promise()
}

const updatePhoneSession = (id, sigDigest, sessionStatus, chainId, txHash, numAttempts, refundTxHash) => {
        const expressions = [
            (sigDigest ? 'sigDigest = :sigDigest' : ''),
            (sessionStatus ? 'sessionStatus = :sessionStatus' : ''),
            (chainId ? 'chainId = :chainId' : ''),
            (txHash ? 'txHash = :txHash' : ''),
            (numAttempts ? 'numAttempts = :numAttempts' : ''),
            (refundTxHash ? 'refundTxHash = :refundTxHash' : '')
        ].filter(x => x !== '').join(', ');
        const updateExpression = 'SET ' + expressions;
        const expressionAttributeValues = {
                ...(sigDigest ? { ':sigDigest': { S: sigDigest } } : {}),
                ...(sessionStatus ? { ':sessionStatus': { S: sessionStatus } } : {}),
                ...(chainId ? { ':chainId': { N: chainId } } : {}),
                ...(txHash ? { ':txHash': { S: txHash } } : {}),
                ...(numAttempts ? { ':numAttempts': { N: numAttempts } } : {}),
                ...(refundTxHash ? { ':refundTxHash': { S: refundTxHash } } : {}),
        };
        const params = {
                TableName: 'phone-sessions',
                Key: { 'id':{ S: `${id}` } },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues
        }
        return ddb.updateItem(params).promise()
}

const getPhoneSessionById = (id) => {
    const params = {
        TableName: 'phone-sessions',
        Key: { 'id':{ S: `${id}` } }
    }
    return ddb.getItem(params).promise()
}

const getPhoneSessionsBySigDigest = (sigDigest) => {
    const params = {
        TableName: 'phone-sessions',
        IndexName: 'sigDigest-index',
        KeyConditionExpression: 'sigDigest = :sigDigest',
        ExpressionAttributeValues: {
            ':sigDigest': { S: `${sigDigest}` }
        }
    }
    return ddb.query(params).promise()
}

const getPhoneSessionByTxHash = async (txHash) => {
    const params = {
            TableName: 'phone-sessions',
            IndexName: 'txHash-index',
            KeyConditionExpression: 'txHash = :txHash',
            ExpressionAttributeValues: {
            ':txHash': { S: `${txHash}` }
        }
    }
    // There should be, at most, one session with with a given txHash, hence
    // the .Items?.[0] below.
    const sessions = await ddb.query(params).promise();
    return sessions?.Items?.[0];
}

// Usage: 
// addNumber('+1234567890')
// numberExists('+1234567890', (x)=>console.log('this should now be true', x))

module.exports = {
    addNumber:addNumber, 
    numberExists:numberExists,
    putPhoneSession,
    updatePhoneSession,
    getPhoneSessionById,
    getPhoneSessionsBySigDigest,
    getPhoneSessionByTxHash,
}

