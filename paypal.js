const axios = require('axios')
const { payPalApiUrlBase } = require('./constants.js')

async function getAccessToken() {
  const url = `${payPalApiUrlBase}/v1/oauth2/token`
  const data = new URLSearchParams({
    grant_type: 'client_credentials'
  })
  const config = {
    auth: {
      username: process.env.PAYPAL_CLIENT_ID,
      password: process.env.PAYPAL_SECRET
    }
  }
  const response = await axios.post(url, data, config)
  return response?.data?.access_token
}

async function getOrder(id, accessToken) {
  const url = `${payPalApiUrlBase}/v2/checkout/orders/${id}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  }
  const resp = await axios.get(url, config)
  return resp.data
}

async function getRefundDetails(id, accessToken) {
  const url = `${payPalApiUrlBase}/v2/payments/refunds/${id}`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  }
  const resp = await axios.get(url, config)
  return resp.data
}

async function capturePayPalOrder(orderId, accessToken) {
  const url = `${payPalApiUrlBase}/v2/checkout/orders/${orderId}/capture`
  const config = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  }
  const resp = await axios.post(url, {}, config)

  return resp.data
}

module.exports = {
  getAccessToken,
  getOrder,
  getRefundDetails,
  capturePayPalOrder
}
