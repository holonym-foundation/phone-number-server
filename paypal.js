const axios = require("axios");

async function getAccessToken() {
  const url =
    process.env.NODE_ENV === "development"
      ? "https://api-m.sandbox.paypal.com/v1/oauth2/token"
      : "https://api-m.paypal.com/v1/oauth2/token";
  const data = new URLSearchParams({
    grant_type: "client_credentials",
  });
  const config = {
    auth: {
      username: process.env.PAYPAL_CLIENT_ID,
      password: process.env.PAYPAL_SECRET,
    },
  };
  const response = await axios.post(url, data, config);
  return response?.data?.access_token;
}

async function getOrder(id, accessToken) {
  const url =
    process.env.NODE_ENV === "development"
      ? `https://api-m.sandbox.paypal.com/v2/checkout/orders/${id}`
      : // TODO: Add production URL
        "";
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  const resp = await axios.get(url, config);
  return resp.data;
}

async function getRefundDetails(id, accessToken) {
  const url =
    process.env.NODE_ENV === "development"
      ? `https://api.sandbox.paypal.com/v2/payments/refunds/${id}`
      : // TODO: Add production URL
        "";
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  const resp = await axios.get(url, config);
  return resp.data;
}
async function capturePayPalOrder(orderId, accessToken) {
  const url =
    process.env.NODE_ENV === "development"
      ? `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/capture`
      : "";
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  const resp = await axios.post(url, {}, config);

  return resp.data;
}

module.exports = {
  getAccessToken,
  getOrder,
  getRefundDetails,
  capturePayPalOrder
};
