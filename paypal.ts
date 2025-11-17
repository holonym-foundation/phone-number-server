import axios from 'axios'
import { payPalApiUrlBase } from './constants.js'

export async function getAccessToken(): Promise<string> {
  const url = `${payPalApiUrlBase}/v1/oauth2/token`
  const data = new URLSearchParams({
    grant_type: 'client_credentials'
  })
  const config = {
    auth: {
      username: process.env.PAYPAL_CLIENT_ID as string,
      password: process.env.PAYPAL_SECRET as string
    }
  }
  const response = await axios.post<{ access_token: string }>(url, data, config)
  return response?.data?.access_token ?? ''
}

export async function getOrder(id: string, accessToken: string): Promise<any> {
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

export async function getRefundDetails(
  id: string,
  accessToken: string
): Promise<any> {
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

export async function capturePayPalOrder(
  orderId: string,
  accessToken: string
): Promise<any> {
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
