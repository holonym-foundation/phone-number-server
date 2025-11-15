var AWS = require('aws-sdk')
AWS.config.update({ region: 'us-east-2' })
var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' })

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

/**
 * @typedef NullifierAndCreds
 * @property {string} issuanceNullifier
 * @property {string} phoneNumber
 * @property {number} createdAt - Unix timestamp
 */

// Helper function to get a phone number from the db
const getNumberParams = (value) => ({
  TableName: 'phone-numbers',
  Key: { phoneNumber: { S: `${value}` } }
})

// Helper function to insert a phone number into the db
const putNumberParams = (value) => ({
  TableName: 'phone-numbers',
  Item: {
    phoneNumber: {
      S: `${value}`
    },
    insertedAt: {
      N: `${Date.now()}`
    }
  }
})

// Returns true if number exists, false otherwise
const numberExists = (number, callback) =>
  ddb.getItem(getNumberParams(number), (err, data) =>
    callback(err, data && 'Item' in data)
  )

// Adds number to the db
const addNumber = (number) =>
  ddb.putItem(putNumberParams(number), (err) => {
    if (err) throw 'Error storing number'
  })

const getNumber = (number, callback) =>
  ddb.getItem(getNumberParams(number), (err, data) => callback(err, data))

const deleteNumber = (number, callback) =>
  ddb.deleteItem(getNumberParams(number), (err, data) => callback(err, data))

/**
 * Common function to put a phone session - works for both live and sandbox
 * `status` is a reserved keyword in DynamoDB, so we name it `sessionStatus`.
 * @param {string} tableName - The table name to use
 * @param {string | undefined} id
 * @param {string | undefined} sigDigest
 * @param {string | undefined} sessionStatus
 * @param {string | undefined} chainId
 * @param {string | undefined} txHash
 * @param {number | undefined} numAttempts
 * @param {string | undefined} refundTxHash
 * @param {string | undefined} payPal
 */
const putPhoneSessionCommon = (
  tableName,
  id,
  sigDigest,
  sessionStatus,
  chainId,
  txHash,
  numAttempts,
  refundTxHash,
  payPal
) => {
  const params = {
    TableName: tableName,
    Item: {
      id: { S: `${id}` },
      sigDigest: { S: `${sigDigest}` },
      sessionStatus: { S: `${sessionStatus}` },
      ...(chainId ? { chainId: { N: `${chainId}` } } : {}),
      ...(txHash ? { txHash: { S: `${txHash}` } } : {}),
      numAttempts: { N: `${numAttempts}` },
      ...(refundTxHash ? { refundTxHash: { S: `${refundTxHash}` } } : {}),
      ...(payPal ? { payPal: { S: `${payPal}` } } : {})
    }
  }
  return ddb.putItem(params).promise()
}

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
const putPhoneSession = (
  id,
  sigDigest,
  sessionStatus,
  chainId,
  txHash,
  numAttempts,
  refundTxHash,
  payPal
) => {
  return putPhoneSessionCommon(
    'phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal
  )
}

/**
 * Common function to update a phone session - works for both live and sandbox
 * @param {string} tableName - The table name to use
 * @param {string | undefined} id
 * @param {string | undefined} sigDigest
 * @param {string | undefined} sessionStatus
 * @param {string | undefined} chainId
 * @param {string | undefined} txHash
 * @param {number | undefined} numAttempts
 * @param {string | undefined} refundTxHash
 * @param {string | undefined} payPal
 * @param {string | undefined} failureReason
 */
const updatePhoneSessionCommon = (
  tableName,
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
    sigDigest ? 'sigDigest = :sigDigest' : '',
    sessionStatus ? 'sessionStatus = :sessionStatus' : '',
    chainId ? 'chainId = :chainId' : '',
    txHash ? 'txHash = :txHash' : '',
    numAttempts ? 'numAttempts = :numAttempts' : '',
    refundTxHash ? 'refundTxHash = :refundTxHash' : '',
    payPal ? 'payPal = :payPal' : '',
    failureReason ? 'failureReason = :failureReason' : ''
  ]
    .filter((x) => x !== '')
    .join(', ')
  const updateExpression = 'SET ' + expressions
  const expressionAttributeValues = {
    ...(sigDigest ? { ':sigDigest': { S: sigDigest } } : {}),
    ...(sessionStatus ? { ':sessionStatus': { S: sessionStatus } } : {}),
    ...(chainId ? { ':chainId': { N: chainId } } : {}),
    ...(txHash ? { ':txHash': { S: txHash } } : {}),
    ...(numAttempts ? { ':numAttempts': { N: `${numAttempts}` } } : {}),
    ...(refundTxHash ? { ':refundTxHash': { S: refundTxHash } } : {}),
    ...(payPal ? { ':payPal': { S: payPal } } : {}),
    ...(failureReason ? { ':failureReason': { S: failureReason } } : {})
  }
  const params = {
    TableName: tableName,
    Key: { id: { S: `${id}` } },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues
  }
  // console.log('updatePhoneSession: update params:', JSON.stringify(params, null, 2))
  return ddb.updateItem(params).promise()
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
 * @param {string | undefined} failureReason
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
  return updatePhoneSessionCommon(
    'phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal,
    failureReason
  )
}

const getPhoneSessionByIdCommon = (tableName, id) => {
  const params = {
    TableName: tableName,
    Key: { id: { S: `${id}` } }
  }
  return ddb.getItem(params).promise()
}

const getPhoneSessionById = (id) => {
  return getPhoneSessionByIdCommon('phone-sessions', id)
}

const getPhoneSessionsBySigDigestCommon = (tableName, sigDigest) => {
  const params = {
    TableName: tableName,
    IndexName: 'sigDigest-index',
    KeyConditionExpression: 'sigDigest = :sigDigest',
    ExpressionAttributeValues: {
      ':sigDigest': { S: `${sigDigest}` }
    }
  }
  return ddb.query(params).promise()
}

const getPhoneSessionsBySigDigest = (sigDigest) => {
  return getPhoneSessionsBySigDigestCommon('phone-sessions', sigDigest)
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
  const sessions = await ddb.query(params).promise()
  return sessions?.Items?.[0]
}

/**
 * Batch put vouchers into DynamoDB.
 *
 * @param {Array} items - Array of PutRequest items for DynamoDB.
 */
const batchPutVouchers = async (items) => {
  const BATCH_SIZE = 25 // max limit of dynamodb
  const batches = []

  // Split items into batches of 25
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE))
  }

  // Write each batch to DynamoDB
  for (const batch of batches) {
    const params = {
      RequestItems: {
        vouchers: batch
      }
    }
    await ddb.batchWriteItem(params).promise()
  }
}

/**
 * @param {string} id
 * @param {boolean | undefined} isRedeemed
 * @param {string | undefined} sessionId
 * @param {string | undefined} txHash
 */
const updateVoucher = (id, isRedeemed, sessionId, txHash) => {
  const expressions = [
    isRedeemed ? 'isRedeemed = :isRedeemed' : '',
    sessionId ? 'sessionId = :sessionId' : '',
    txHash ? 'txHash = :txHash' : ''
  ]
    .filter((x) => x !== '')
    .join(', ')
  const updateExpression = 'SET ' + expressions
  const expressionAttributeValues = {
    ...(isRedeemed ? { ':isRedeemed': { BOOL: isRedeemed } } : {}),
    ...(sessionId ? { ':sessionId': { S: sessionId } } : {}),
    ...(txHash ? { ':txHash': { S: txHash } } : {})
  }
  const params = {
    TableName: 'vouchers',
    Key: { id: { S: `${id}` } },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues
  }
  return ddb.updateItem(params).promise()
}

const getVoucherById = (id) => {
  const params = {
    TableName: 'vouchers',
    Key: { id: { S: `${id}` } }
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
  const vouchers = await ddb.query(params).promise()
  console.log('sessions tx hash', vouchers)
  return vouchers?.Items?.[0]
}

const putNullifierAndCredsCommon = (
  tableName,
  issuanceNullifier,
  phoneNumber
) => {
  const params = {
    TableName: tableName,
    Item: {
      issuanceNullifier: { S: `${issuanceNullifier}` },
      phoneNumber: { S: `${phoneNumber}` },
      createdAt: { N: `${Date.now().toString()}` }
    }
  }
  return ddb.putItem(params).promise()
}

const putNullifierAndCreds = (issuanceNullifier, phoneNumber) => {
  return putNullifierAndCredsCommon(
    'phone-nullifier-and-creds',
    issuanceNullifier,
    phoneNumber
  )
}

const getNullifierAndCredsByNullifierCommon = (
  tableName,
  issuanceNullifier
) => {
  const params = {
    TableName: tableName,
    Key: { issuanceNullifier: { S: `${issuanceNullifier}` } }
  }
  return ddb.getItem(params).promise()
}

const getNullifierAndCredsByNullifier = (issuanceNullifier) => {
  return getNullifierAndCredsByNullifierCommon(
    'phone-nullifier-and-creds',
    issuanceNullifier
  )
}

// ========== SANDBOX FUNCTIONS ==========
// These are thin wrappers around the common functions

/**
 * Sandbox version of putPhoneSession - uses sandbox-phone-sessions table
 */
const putSandboxPhoneSession = (
  id,
  sigDigest,
  sessionStatus,
  chainId,
  txHash,
  numAttempts,
  refundTxHash,
  payPal
) => {
  return putPhoneSessionCommon(
    'sandbox-phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal
  )
}

/**
 * Sandbox version of updatePhoneSession - uses sandbox-phone-sessions table
 */
const updateSandboxPhoneSession = (
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
  return updatePhoneSessionCommon(
    'sandbox-phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal,
    failureReason
  )
}

const getSandboxPhoneSessionById = (id) => {
  return getPhoneSessionByIdCommon('sandbox-phone-sessions', id)
}

const getSandboxPhoneSessionsBySigDigest = (sigDigest) => {
  return getPhoneSessionsBySigDigestCommon('sandbox-phone-sessions', sigDigest)
}

// const putSandboxNullifierAndCreds = (issuanceNullifier, phoneNumber) => {
//   return putNullifierAndCredsCommon('sandbox-nullifier-and-creds', issuanceNullifier, phoneNumber)
// }

// const getSandboxNullifierAndCredsByNullifier = (issuanceNullifier) => {
//   return getNullifierAndCredsByNullifierCommon('sandbox-nullifier-and-creds', issuanceNullifier)
// }

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
  putNullifierAndCreds,
  getNullifierAndCredsByNullifier,
  putSandboxPhoneSession,
  updateSandboxPhoneSession,
  getSandboxPhoneSessionById,
  getSandboxPhoneSessionsBySigDigest
  // putSandboxNullifierAndCreds,
  // getSandboxNullifierAndCredsByNullifier
}
