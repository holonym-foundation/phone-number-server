const {
  updatePhoneSession,
  updateSandboxPhoneSession
} = require('./dynamodb.js')
const { sessionStatusEnum } = require('./constants.js')

async function failPhoneSession(sessionId, failureReason) {
  await updatePhoneSession(
    sessionId,
    null,
    sessionStatusEnum.VERIFICATION_FAILED,
    null,
    null,
    null,
    null,
    null,
    failureReason
  )
}

async function setPhoneSessionIssued(sessionId) {
  await updatePhoneSession(
    sessionId,
    null,
    sessionStatusEnum.ISSUED,
    null,
    null,
    null,
    null,
    null,
    null
  )
}

async function failSandboxPhoneSession(sessionId, failureReason) {
  await updateSandboxPhoneSession(
    sessionId,
    null,
    sessionStatusEnum.VERIFICATION_FAILED,
    null,
    null,
    null,
    null,
    null,
    failureReason
  )
}

async function setSandboxPhoneSessionIssued(sessionId) {
  await updateSandboxPhoneSession(
    sessionId,
    null,
    sessionStatusEnum.ISSUED,
    null,
    null,
    null,
    null,
    null,
    null
  )
}

module.exports = {
  failPhoneSession,
  setPhoneSessionIssued,
  failSandboxPhoneSession,
  setSandboxPhoneSessionIssued
}
