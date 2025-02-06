var AWS = require('aws-sdk');
AWS.config.update({region:'us-east-2'});
var ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

/**
 * @typedef PayPalOrder
 * @property {string} id
 * @property {string} createdAt
 */

/**
 * @typedef PhoneSessionPayPalData
 * @property {Array<PayPalOrder>} orders
 */

/**
 * @typedef PhoneSession
 * @property {string} id
 * @property {string} sigDigest 
 * @property {string} sessionStatus 
 * @property {string | undefined} chainId 
 * @property {string | undefined} txHash 
 * @property {number} numAttempts 
 * @property {string | undefined} refundTxHash 
 * @property {string | undefined} payPal JSON stringified PhoneSessionPayPalData
 */

// Helper function to get a phone number from the db
const getNumberParams = (value) => ({
    TableName: 'phone-numbers',
    Key: { 'phoneNumber': { S: `${value}` } }
})

// Helper function to insert a phone number into the db
const putNumberParams = (value) => ({
    TableName: 'phone-numbers',
    Item: {
        'phoneNumber': {
            S: `${value}`
        },
        'insertedAt': {
            N: `${Date.now()}`
        }
    }
})

// Returns true if number exists, false otherwise
const numberExists = (number, callback) => ddb.getItem(getNumberParams(number), (err, data) => callback(err, data && "Item" in data))

// Adds number to the db
const addNumber = (number) => ddb.putItem(putNumberParams(number), (err) => { if (err) throw 'Error storing number' })

const getNumber = (number, callback) => ddb.getItem(getNumberParams(number), (err, data) => callback(err, data))

const deleteNumber = (number, callback) => ddb.deleteItem(getNumberParams(number), (err, data) => callback(err, data))

/**
 * `status` is a reserved keyword in DynamoDB, so we name it `sessionStatus`.
 * @param {string | undefined} id 
 * @param {string | undefined} sigDigest 
 * @param {string | undefined} sessionStatus 
 * @param {string | undefined} chainId 
 * @param {string | undefined} txHash 
 * @param {number | undefined} numAttempts 
 * @param {string | undefined} refundTxHash 
 * @param {string | undefined} payPal 
 */
const putPhoneSession = (id, sigDigest, sessionStatus, chainId, txHash, numAttempts, refundTxHash, payPal) => {
    const params = {
        TableName: 'phone-sessions',
        Item: {
            'id': { S: `${id}` },
            'sigDigest': { S: `${sigDigest}` },
            'sessionStatus': { S: `${sessionStatus}` },
            ...(chainId ? { 'chainId': { N: `${chainId}` } } : {}),
            ...(txHash ? { 'txHash': { S: `${txHash}` } } : {}),
            'numAttempts': { N: `${numAttempts}` },
            ...(refundTxHash ? { 'refundTxHash': { S: `${refundTxHash}` } } : {}),
            ...(payPal ? { 'payPal': { S: `${payPal}` } } : {})
        }
    }
    return ddb.putItem(params).promise()
}

/**
 * @param {string | undefined} id 
 * @param {string | undefined} sigDigest 
 * @param {string | undefined} sessionStatus 
 * @param {string | undefined} chainId 
 * @param {string | undefined} txHash 
 * @param {number | undefined} numAttempts 
 * @param {string | undefined} refundTxHash 
 * @param {string | undefined} payPal 
 */
const updatePhoneSession = (
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal,
    failureReason
) => {
    // console.log(
    //     'updating session. args:',
    //     [id, sigDigest, sessionStatus, chainId, txHash, numAttempts, refundTxHash, payPal]
    // )
    const expressions = [
        (sigDigest ? 'sigDigest = :sigDigest' : ''),
        (sessionStatus ? 'sessionStatus = :sessionStatus' : ''),
        (chainId ? 'chainId = :chainId' : ''),
        (txHash ? 'txHash = :txHash' : ''),
        (numAttempts ? 'numAttempts = :numAttempts' : ''),
        (refundTxHash ? 'refundTxHash = :refundTxHash' : ''),
        (payPal ? 'payPal = :payPal' : ''),
        (failureReason ? 'failureReason = :failureReason' : '')
    ].filter(x => x !== '').join(', ');
    const updateExpression = 'SET ' + expressions;
    const expressionAttributeValues = {
        ...(sigDigest ? { ':sigDigest': { S: sigDigest } } : {}),
        ...(sessionStatus ? { ':sessionStatus': { S: sessionStatus } } : {}),
        ...(chainId ? { ':chainId': { N: chainId } } : {}),
        ...(txHash ? { ':txHash': { S: txHash } } : {}),
        ...(numAttempts ? { ':numAttempts': { N: `${numAttempts}` } } : {}),
        ...(refundTxHash ? { ':refundTxHash': { S: refundTxHash } } : {}),
        ...(payPal ? { ':payPal': { S: payPal } } : {}),
        ...(failureReason ? { ':failureReason': { S: failureReason } } : {})
    };
    const params = {
        TableName: 'phone-sessions',
        Key: { 'id': { S: `${id}` } },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues
    }
    // console.log('updatePhoneSession: update params:', JSON.stringify(params, null, 2))
    return ddb.updateItem(params).promise()
}

const getPhoneSessionById = (id) => {
    const params = {
        TableName: 'phone-sessions',
        Key: { 'id': { S: `${id}` } }
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

/**
 * Batch put vouchers into DynamoDB.
 * 
 * @param {Array} items - Array of PutRequest items for DynamoDB.
 */
const batchPutVouchers = async (items) => {
    const BATCH_SIZE = 25; // max limit of dynamodb
    const batches = [];
  
    // Split items into batches of 25
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }
  
    // Write each batch to DynamoDB
    for (const batch of batches) {
      const params = {
        RequestItems: {
          'vouchers': batch,
        },
      };
      await ddb.batchWriteItem(params).promise();
    }
  };

/**
 * @param {string} id 
 * @param {boolean | undefined} isRedeemed 
 * @param {string | undefined} sessionId 
 * @param {string | undefined} txHash 
 */
const updateVoucher = (
    id,
    isRedeemed,
    sessionId,
    txHash,
) => {
    const expressions = [
        (isRedeemed ? 'isRedeemed = :isRedeemed' : ''),
        (sessionId ? 'sessionId = :sessionId' : ''),
        (txHash ? 'txHash = :txHash' : ''),
    ].filter(x => x !== '').join(', ');
    const updateExpression = 'SET ' + expressions;
    const expressionAttributeValues = {
        ...(isRedeemed ? { ':isRedeemed': { BOOL: isRedeemed } } : {}),
        ...(sessionId ? { ':sessionId': { S: sessionId } } : {}),
        ...(txHash ? { ':txHash': { S: txHash } } : {}),
    };
    const params = {
        TableName: 'vouchers',
        Key: { 'id': { S: `${id}` } },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues
    }
    return ddb.updateItem(params).promise()
}

const getVoucherById = (id) => {
    const params = {
        TableName: 'vouchers',
        Key: { 'id': { S: `${id}` } }
    }
    return ddb.getItem(params).promise()
}

const getVoucherByTxHash = async (txHash) => {
    const params = {
        TableName: 'vouchers',
        IndexName: 'txHash-index',
        KeyConditionExpression: 'txHash = :txHash',
        ExpressionAttributeValues: {
            ':txHash': { S: `${txHash}` }
        }
    }
    const vouchers = await ddb.query(params).promise();
    console.log('sessions tx hash', vouchers)
    return vouchers?.Items?.[0];
}
// Usage: 
// addNumber('+1234567890')
// numberExists('+1234567890', (x)=>console.log('this should now be true', x))

module.exports = {
    addNumber: addNumber,
    numberExists: numberExists,
    getNumber,
    deleteNumber,
    putPhoneSession,
    updatePhoneSession,
    getPhoneSessionById,
    getPhoneSessionsBySigDigest,
    getPhoneSessionByTxHash,
    getVoucherByTxHash,
    batchPutVouchers,
    getVoucherById,
    updateVoucher,
}

