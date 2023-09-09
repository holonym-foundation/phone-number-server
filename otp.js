require('dotenv').config();
const { createClient } = require('redis');
const crypto = require('crypto');
const Messente = require('messente_api');

const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_ATTEMPTS_COOLDOWN = 60 * 30; // 30 minutes
const OTP_EXPIRY = 60 * 5; // 5 minutes
const MAX_COUNTRY_ATTEMP_PER_MINUTE = 10;
const MAX_COUNTRY_ATTEMP_PER_HOUR = 200;

const redis = createClient();
redis.on('error', err => console.log('Redis Client Error', err));
redis.connect();

const client = Messente.ApiClient.instance;
const basicAuth = client.authentications['basicAuth'];
basicAuth.username = process.env.MESSENTE_API_USERNAME;
basicAuth.password = process.env.MESSENTE_API_PASSWORD;
const api = new Messente.OmnimessageApi();

const getOTP = () => crypto.randomInt(0,1000000).toString().padStart(6,'0')

const cacheCountryRequest = async (countryCode) => {
    const minuteKey = `minute:${countryCode}`;
    const hourKey = `hour:${countryCode}`;

    const countMinut = await redis.hIncrBy('country_requests_minutes', minuteKey, 1);
    const countHour = await redis.hIncrBy('country_requests_hours', hourKey, 1);

    await redis.expire('country_requests_minutes', 60)
    await redis.expire('country_requests_hours', 3600) 
    if(countMinut > MAX_COUNTRY_ATTEMP_PER_MINUTE || countHour > MAX_COUNTRY_ATTEMP_PER_HOUR) {
        throw new Error('Too many recent attempts from country ', country) 
    }
}

const cacheOTP = async (phoneNumber, otp) => {
    await redis.set(`OTP:${phoneNumber}`, otp, 'EX',OTP_EXPIRY)
}

const checkOTP = async (phoneNumber, otp) => {
    // console.log('DEBUGGING: OTP should be', await redis.get(phoneNumber)
    // Rate limit:
    const recentAttempts = await redis.incr(`RecentAttempts:${phoneNumber}`)
    await redis.expire(`RecentAttempts:${phoneNumber}`, MAX_OTP_ATTEMPTS_COOLDOWN)
    if (recentAttempts > MAX_OTP_ATTEMPTS) throw new Error('Too many recent attempts')

    const cachedOTP = await redis.get(`OTP:${phoneNumber}`)

    if (!cachedOTP) throw new Error('OTP not found')
    if (cachedOTP !== otp) throw new Error('OTP does not match')

    // If we got here it was successful. Clear and return true
    await redis.del(`OTP:${phoneNumber}`)
    await redis.del(`RecentAttempts:${phoneNumber}`)
    return true
}

const sendOTP = async (phoneNumber, otp) => {
    const text = `${otp} is your verification code`;
    const sender = 'Holonym';

    const viber = Messente.Viber.constructFromObject({text, sender});
    // const whatsappText = Messente.WhatsAppText.constructFromObject({text});
    // const whatsapp = Messente.WhatsApp.constructFromObject({text:whatsappText});
    const sms = Messente.SMS.constructFromObject({text, sender});

    const omnimessage = Messente.Omnimessage.constructFromObject({
        messages: [sms, viber],
        to: phoneNumber
    });

    api.sendOmnimessage(omnimessage, (error, data, response) => {
        console.error('error?', error);
        console.log('data', data);
        console.log('response', response)
    })
}

async function begin(phoneNumber, countryCode) {
    const otp = getOTP();
    await cacheCountryRequest(countryCode)
    await cacheOTP(phoneNumber, otp);
    await sendOTP(phoneNumber, otp);
}

async function verify(phoneNumber, otp) {
    return await checkOTP(phoneNumber, otp);
}


module.exports = {
    begin,
    verify
}
// todo: fallbacks: viber -> whatsapp -> sms? or sms -> viber -> whatsapp? or sms -> whatsapp -> viber? SMS is most expensive but also what our users expect. Perhaps do viber or whatsapp if SMS doesn't deliver??
// todo: delivery webhook