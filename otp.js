require('dotenv').config()
const crypto = require('crypto')
const Messente = require('messente_api')
const { ERROR_MESSAGES } = require('./constants.js')
const { redis } = require('./redis.js')

const OTP_EXPIRY = 60 * 5 // 5 minutes

const client = Messente.ApiClient.instance
const basicAuth = client.authentications['basicAuth']
basicAuth.username = process.env.MESSENTE_API_USERNAME
basicAuth.password = process.env.MESSENTE_API_PASSWORD
const api = new Messente.OmnimessageApi()

const MAX_COUNTRY_ATTEMPTS_PER_MINUTE = 10
const MAX_COUNTRY_ATTEMPTS_PER_HOUR = 300

const getOTP = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0')

const cacheRequestFromCountry = async (countryCode) => {
  const minuteKey = `country_requests_minutes:minute:${countryCode}`
  const hourKey = `country_requests_minutes:hour:${countryCode}`
  const countMinute = await redis.incr(minuteKey)
  const countHour = await redis.incr(hourKey)

  const minuteTTL = await redis.ttl(minuteKey)
  const hourTTL = await redis.ttl(hourKey)
  // -2 means the key does not exist. -1 means the key is not set to expire.
  if (minuteTTL < 0) {
    await redis.expire(minuteKey, 60)
  }
  if (hourTTL < 0) {
    await redis.expire(hourKey, 3600)
  }

  if (
    countMinute > MAX_COUNTRY_ATTEMPTS_PER_MINUTE ||
    countHour > MAX_COUNTRY_ATTEMPTS_PER_HOUR
  ) {
    throw new Error(
      `${ERROR_MESSAGES.TOO_MANY_ATTEMPTS_COUNTRY} ${countryCode}`
    )
  }
}

const cacheOTP = async (phoneNumber, otp) => {
  await redis.set(`OTP:${phoneNumber}`, otp, 'EX', OTP_EXPIRY)
}

const checkOTP = async (phoneNumber, otp) => {
  const cachedOTP = await redis.get(`OTP:${phoneNumber}`)

  if (!cachedOTP) throw new Error(ERROR_MESSAGES.OTP_NOT_FOUND)
  if (cachedOTP !== otp) throw new Error(ERROR_MESSAGES.OTP_DOES_NOT_MATCH)

  // If we got here it was successful. Clear and return true
  await redis.del(`OTP:${phoneNumber}`)
  return true
}

const sendOTP = async (phoneNumber, otp) => {
  const text = `${otp} is your verification code`
  const sender = 'Holonym'

  // const viber = Messente.Viber.constructFromObject({text, sender});
  // const whatsappText = Messente.WhatsAppText.constructFromObject({text});
  // const whatsapp = Messente.WhatsApp.constructFromObject({text:whatsappText});
  const sms = Messente.SMS.constructFromObject({ text, sender })

  const omnimessage = Messente.Omnimessage.constructFromObject({
    messages: [sms /*,viber*/],
    to: phoneNumber
  })

  api.sendOmnimessage(omnimessage, (error, data, response) => {
    console.error('error?', error)
    console.log('data', data)
    // console.log('response', response)
  })
}

async function begin(phoneNumber, countryCode) {
  const otp = getOTP()
  await cacheRequestFromCountry(countryCode)
  await cacheOTP(phoneNumber, otp)
  await sendOTP(phoneNumber, otp)
}

async function verify(phoneNumber, otp) {
  return await checkOTP(phoneNumber, otp)
}

module.exports = {
  begin,
  verify
}
// todo: fallbacks: viber -> whatsapp -> sms? or sms -> viber -> whatsapp? or sms -> whatsapp -> viber? SMS is most expensive but also what our users expect. Perhaps do viber or whatsapp if SMS doesn't deliver??
// todo: delivery webhook
