const { randomBytes } = require('crypto');
const express = require("express");
const axios = require('axios');
const { createClient } = require('redis');
const { ethers } = require('ethers');
const {
  putPhoneSession,
  updatePhoneSession,
  getPhoneSessionById,
  getPhoneSessionsBySigDigest,
  getPhoneSessionByTxHash,
  getVoucherByTxHash,
  getVoucherById,
  updateVoucher,
  batchPutVouchers,
} = require('./dynamodb.js');
const {
  sessionStatusEnum,
  supportedChainIds,
  idServerPaymentAddress,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  baseProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  payPalApiUrlBase,
} = require('./constants.js');
const {
  getAccessToken: getPayPalAccessToken,
  getOrder: getPayPalOrder,
  getRefundDetails: getPayPalRefundDetails,
  capturePayPalOrder
} = require('./paypal.js');
const { usdToETH, usdToFTM, usdToAVAX, retry } = require('./utils.js');

const redis = createClient();
redis.on('error', err => console.log('Redis Client Error', err));
redis.connect();

function getTransaction(chainId, txHash) {
  if (chainId === 1) {
    return ethereumProvider.getTransaction(txHash);
  } else if (chainId === 10) {
    return optimismProvider.getTransaction(txHash);
  } else if (chainId === 250) {
    return fantomProvider.getTransaction(txHash);
  } else if (chainId === 8453) {
    return baseProvider.getTransaction(txHash);
  } else if (chainId === 43114) {
    return avalancheProvider.getTransaction(txHash);
  } else if (chainId === 1313161554) {
    return auroraProvider.getTransaction(txHash);
  } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    return optimismGoerliProvider.getTransaction(txHash);
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
}

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount.
 * - Ensure tx is confirmed.
 */
async function validateTxForSessionPayment(session, chainId, txHash, desiredAmount) {
  // Transactions on L2s mostly go through within a few seconds. Mainnet can take 15s or
  // possibly even longer.
  const tx = await retry(() => getTransaction(chainId, txHash), 5, 5000);

  if (!tx) {
    return {
      status: 400,
      error: `Could not find transaction with txHash ${txHash} on chain ${chainId}`,
    };
  }

  if (idServerPaymentAddress !== tx.to.toLowerCase()) {
    return {
      status: 400,
      error: `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`,
    };
  }

  // NOTE: This const must stay in sync with the frontend.
  // We allow a 2% margin of error.
  const expectedAmountInUSD = desiredAmount * 0.98;

  let expectedAmountInToken;
  if ([1, 10, 1313161554, 8453].includes(chainId)) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  } else if (chainId === 250) {
    expectedAmountInToken = await usdToFTM(expectedAmountInUSD);
  } else if (chainId === 43114) {
    expectedAmountInToken = await usdToAVAX(expectedAmountInUSD);
  }
  else if (process.env.NODE_ENV === "development" && chainId === 420) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  }

  // Round to 18 decimal places to avoid this underflow error from ethers:
  // "fractional component exceeds decimals"
  const decimals = 18;
  const multiplier = 10 ** decimals;
  const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier;

  const expectedAmount = ethers.utils.parseEther(rounded.toString());

  if (tx.value.lt(expectedAmount)) {
    return {
      status: 400,
      error: `Invalid transaction amount. Amount must be greater than ${expectedAmount.toString()} on chain ${chainId}`,
    };
  }

  if (!tx.blockHash || tx.confirmations === 0) {
    return {
      status: 400,
      error: "Transaction has not been confirmed yet.",
    };
  }

  const sessionWithTxHash = await getPhoneSessionByTxHash(txHash)

  if (sessionWithTxHash) {
    return {
      status: 400,
      error: "Transaction has already been used to pay for a session",
    };
  }

  const sidDigest = ethers.utils.keccak256("0x" + session.Item.id.S);
  if (tx.data !== sidDigest) {
    return {
      status: 400,
      error: "Invalid transaction data",
    };
  }

  return {};
}

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount.
 * - Ensure tx is confirmed.
 */
async function validateTxForVoucherPayment(chainId, txHash, desiredAmount) {
  let tx;
  if (chainId === 1) {
    tx = await ethereumProvider.getTransaction(txHash);
  } else if (chainId === 10) {
    tx = await optimismProvider.getTransaction(txHash);
  } else if (chainId === 250) {
    tx = await fantomProvider.getTransaction(txHash);
  } else if (chainId === 8453) {
    tx = await baseProvider.getTransaction(txHash);
  } else if (chainId === 43114) {
    tx = await avalancheProvider.getTransaction(txHash);
  } else if (chainId === 1313161554) {
    tx = await auroraProvider.getTransaction(txHash);
  } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    tx = await optimismGoerliProvider.getTransaction(txHash);
  }

  if (!tx) {
    return {
      status: 400,
      error: "Could not find transaction with given txHash",
    };
  }

  if (idServerPaymentAddress !== tx.to.toLowerCase()) {
    return {
      status: 400,
      error: `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`,
    };
  }

  // NOTE: This const must stay in sync with the frontend.
  // We allow a 2% margin of error.
  const expectedAmountInUSD = desiredAmount * 0.98;

  let expectedAmountInToken;
  if ([1, 10, 1313161554, 8453].includes(chainId)) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  } else if (chainId === 250) {
    expectedAmountInToken = await usdToFTM(expectedAmountInUSD);
  } else if (chainId === 43114) {
    expectedAmountInToken = await usdToAVAX(expectedAmountInUSD);
  }
  else if (process.env.NODE_ENV === "development" && chainId === 420) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  }

  // Round to 18 decimal places to avoid this underflow error from ethers:
  // "fractional component exceeds decimals"
  const decimals = 18;
  const multiplier = 10 ** decimals;
  const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier;

  const expectedAmount = ethers.utils.parseEther(rounded.toString());

  if (tx.value.lt(expectedAmount)) {
    return {
      status: 400,
      error: `Invalid transaction amount. Amount must be greater than ${expectedAmount.toString()} on chain ${chainId}`,
    };
  }

  if (!tx.blockHash || tx.confirmations === 0) {
    return {
      status: 400,
      error: "Transaction has not been confirmed yet.",
    };
  }

  const voucherWithTxHash = await getVoucherByTxHash(txHash);

  if (voucherWithTxHash) {
    return {
      status: 400,
      error: "Transaction has already been used to generate voucher",
    };
  }

  return {};
}

async function refundMintFeeOnChain(session, to) {
  let provider;
  if (Number(session.Item.chainId.N) === 1) {
    provider = ethereumProvider;
  } else if (Number(session.Item.chainId.N) === 10) {
    provider = optimismProvider;
  } else if (Number(session.Item.chainId.N) === 250) {
    provider = fantomProvider;
  } else if (Number(session.Item.chainId.N) === 8453) {
    provider = baseProvider;
  } else if (Number(session.Item.chainId.N) === 43114) {
    provider = avalancheProvider;
  } else if (Number(session.Item.chainId.N) === 1313161554) {
    provider = auroraProvider;
  } else if (process.env.NODE_ENV === "development" && Number(session.Item.chainId.N) === 420) {
    provider = optimismGoerliProvider;
  }

  const tx = await provider.getTransaction(session.Item.txHash.S);

  if (!tx) {
    return {
      status: 404,
      data: {
        error: "Could not find transaction with given txHash",
      },
    };
  }

  const wallet = new ethers.Wallet(process.env.PAYMENTS_PRIVATE_KEY, provider);

  // Refund 69.1% of the transaction amount. This approximates the mint cost to
  // a fraction of a cent.
  const refundAmount = tx.value.mul(691).div(1000);

  // Ensure wallet has enough funds to refund
  const balance = await wallet.getBalance();
  if (balance.lt(refundAmount)) {
    return {
      status: 500,
      data: {
        error: "Wallet does not have enough funds to refund. Please contact support.",
      },
    };
  }

  const txReq = await wallet.populateTransaction({
    to: to,
    value: refundAmount,
  });

  // For some reason gas estimates from Fantom are way off. We manually increase
  // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
  // in the future. The following values happened to be sufficient at the time
  // of adding this block.
  if (Number(session.Item.chainId.N) === 250) {
    txReq.maxFeePerGas = txReq.maxFeePerGas.mul(2);
    txReq.maxPriorityFeePerGas = txReq.maxPriorityFeePerGas.mul(14);

    if (txReq.maxPriorityFeePerGas.gt(txReq.maxFeePerGas)) {
      txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
    }
  }

  const txResponse = await wallet.sendTransaction(txReq);

  const receipt = await txResponse.wait();

  await updatePhoneSession(
    session.Item.id.S,
    null,
    sessionStatusEnum.REFUNDED,
    null,
    null,
    null,
    receipt.transactionHash,
    null,
    null
  )

  return {
    status: 200,
    data: {
      txReceipt: receipt,
    },
  };
}

async function refundMintFeePayPal(session) {
  const accessToken = await getPayPalAccessToken();

  const payPalData = JSON.parse(session?.Item?.payPal?.S ?? '{}')
  const orders = payPalData.orders ?? [];

  if (orders.length === 0) {
    return {
      status: 404,
      data: {
        error: "No PayPal orders found for session",
      },
    };
  }

  let successfulOrder;
  for (const { id: orderId } of orders) {
    const order = await getPayPalOrder(orderId, accessToken);
    if (order.status === "COMPLETED") {
      successfulOrder = order;
      break;
    }
  }

  if (!successfulOrder) {
    return {
      status: 404,
      data: {
        error: "No successful PayPal orders found for session",
      },
    };
  }

  // Get the first successful payment capture
  let capture;
  for (const pu of successfulOrder.purchase_units) {
    for (const payment of pu.payments.captures) {
      if (payment.status === "COMPLETED") {
        capture = payment;
        break;
      }
    }
  }

  if (!capture) {
    return {
      status: 404,
      data: {
        error: "No successful PayPal payment captures found for session",
      },
    };
  }

  const paymentId = capture.id;

  // PayPal returns a 403 when trying to get refund details. Not sure if this
  // is because no refund exists had been performed yet or because of some other.
  // issue I tried creating new credentials and using the sandbox API but still
  // got a 403.
  // const refundDetails = await getPayPalRefundDetails(paymentId, accessToken);

  // if (refundDetails.status === "COMPLETED") {
  //   return {
  //     status: 400,
  //     data: {
  //       error: "Payment has already been refunded",
  //     },
  //   };
  // }

  const url = `${payPalApiUrlBase}/v2/payments/captures/${paymentId}/refund`
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  const data = {
    amount: {
      value: "2.53",
      currency_code: "USD",
    },
    // invoice_id: "INVOICE-123",
    note_to_payer: "Failed verification",
  };
  const resp = await axios.post(url, data, config);

  if (resp.data?.status !== "COMPLETED") {
    return {
      status: 500,
      data: {
        error: "Error refunding payment",
      },
    };
  }

  await updatePhoneSession(
    session.Item.id.S,
    null,
    sessionStatusEnum.REFUNDED,
    null,
    null,
    null,
    null,
    null,
    null
  )

  return {
    status: 200,
    data: {},
  };
}

/**
 * ENDPOINT.
 * 
 * Creates a session.
 */
async function postSession(req, res) {
  try {
    const sigDigest = req.body.sigDigest;
    if (!sigDigest) {
      return res.status(400).json({ error: "sigDigest is required" });
    }

    const id = randomBytes(32).toString('hex')
    await putPhoneSession(
      id,
      sigDigest,
      sessionStatusEnum.NEEDS_PAYMENT,
      null,
      null,
      0,
      null,
      null
    )

    return res.status(201).json({
      id,
      sigDigest,
      sessionStatus: sessionStatusEnum.NEEDS_PAYMENT,
      numAttempts: 0,
    });
  } catch (err) {
    console.log("postSession: Error:", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function createPayPalOrder(req, res) {
  try {
    const id = req.params.id;

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    const accessToken = await getPayPalAccessToken();

    const url = `${payPalApiUrlBase}/v2/checkout/orders`
    const body = {
      intent: "CAPTURE",
      purchase_units: [
        {
          // reference_id: `idv-session-${_id}`,
          amount: {
            currency_code: "USD",
            value: "5.00",
          },
        },
      ],
      // payment_source: {
      //   paypal: {
      //     experience_context: {
      //       payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
      //       brand_name: "EXAMPLE INC",
      //       locale: "en-US",
      //       landing_page: "LOGIN",
      //       shipping_preference: "SET_PROVIDED_ADDRESS",
      //       user_action: "PAY_NOW",
      //       return_url: "https://example.com/returnUrl",
      //       cancel_url: "https://example.com/cancelUrl",
      //     },
      //   },
      // },
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    };

    const resp = await axios.post(url, body, config);

    const order = resp.data;

    console.log('session?.Item?.payPal?.S', session?.Item?.payPal?.S)
    const sessionPayPalData = JSON.parse(session?.Item?.payPal?.S ?? '{}')

    if ((sessionPayPalData?.orders ?? []).length > 0) {
      sessionPayPalData.orders.push({
        id: order.id,
        createdAt: new Date().getTime().toString()
      });
    } else {
      sessionPayPalData.orders = [{
        id: order.id,
        createdAt: new Date().getTime().toString()
      }]
    }

    await updatePhoneSession(
      id,
      null,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify(sessionPayPalData),
      null,
    )

    return res.status(201).json(order);
  } catch (err) {
    if (err.response) {
      console.error(
        { error: err.response.data },
        "Error creating PayPal order"
      );
    } else if (err.request) {
      console.error(
        { error: err.request.data },
        "Error creating PayPal order"
      );
    } else {
      console.error({ error: err }, "Error creating PayPal order");
    }
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function payment(req, res) {
  try {
    const id = req.params.id;
    const chainId = Number(req.body.chainId);
    const txHash = req.body.txHash;
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ", "
        )}`,
      });
    }
    if (!txHash) {
      return res.status(400).json({ error: "txHash is required" });
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session?.Item?.txHash?.S) {
      return res
        .status(400)
        .json({ error: "Session is already associated with a transaction" });
    }

    const validationResult = await validateTxForSessionPayment(session, chainId, txHash, 5);
    if (validationResult.error) {
      console.log("Invalid transaction. Error:", validationResult.error);
      return res
        .status(validationResult.status)
        .json({ error: validationResult.error });
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      chainId.toString(),
      txHash,
      null,
      null,
      null,
      null
    )

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err.response) {
      console.error("session payment endpoint: error:", err.response.data);
    } else if (err.request) {
      console.error("session payment endpoint: error:", err.request.data);
    } else {
      console.error("session payment endpoint: error:", err);
    }
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function paymentV2(req, res) {
  try {
    if (req.body.chainId && req.body.txHash) {
      return payment(req, res);
    }

    const id = req.params.id;
    const orderId = req.body.orderId;

    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" });
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.Item.sessionStatus?.S !== sessionStatusEnum.NEEDS_PAYMENT) {
      return res.status(400).json({
        error: `Session status is '${session.Item.sessionStatus?.S}'. Expected '${sessionStatusEnum.NEEDS_PAYMENT}'`,
      });
    }

    const payPalData = JSON.parse(session?.Item?.payPal?.S ?? '{}')

    const filteredOrders = (payPalData?.orders ?? []).filter(
      (order) => order.id === orderId
    );
    if (filteredOrders.length === 0) {
      return res.status(400).json({
        error: `Order ${orderId} is not associated with session ${id}`,
      });
    }

    // TODO: Scan all phone sessions for a session with this PayPal order ID.
    // And ensure that this order ID is not associated with any other session
    // const sessions = ...
    // if (sessions.length > 0) {
    //   return res.status(400).json({
    //     error: `Order ${orderId} is already associated with session ${sessions[0]._id}`,
    //   });
    // }

    const accessToken = await getPayPalAccessToken();

    const order = await capturePayPalOrder(orderId, accessToken);

    if (order.status !== "COMPLETED") {
      return res.status(400).json({
        error: `Order ${orderId} has status ${order.status}. Must be COMPLETED`,
      });
    }

    const expectedAmountInUSD = 5;

    let successfulOrder;
    for (const pu of order.purchase_units) {
      for (const payment of pu.payments.captures) {
        if (payment.status === "COMPLETED") {
          if (Number(payment.amount.value) >= expectedAmountInUSD) {
            successfulOrder = order;
          }
          break;
        }
      }
    }

    if (!successfulOrder) {
      return res.status(400).json({
        error: `Order ${orderId} does not have a successful payment capture with amount >= ${expectedAmountInUSD}`,
      });
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      null,
      null,
      null,
      null,
      null,
      null
    )

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err.response) {
      console.error(
        { error: err.response.data },
        "Error in paymentV2"
      );
    } else if (err.request) {
      console.error(
        { error: err.request.data },
        "Error in paymentV2"
      );
    } else {
      console.error({ error: err }, "Error in paymentV2");
    }

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function paymentV3(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id = req.params.id;
    const chainId = Number(req.body.chainId);
    const txHash = req.body.txHash;
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ", "
        )}`,
      });
    }
    if (!txHash) {
      return res.status(400).json({ error: "txHash is required" });
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session?.Item?.txHash?.S) {
      return res
        .status(400)
        .json({ error: "Session is already associated with a transaction" });
    }

    const validationResult = await validateTxForSessionPayment(session, chainId, txHash, 3);
    if (validationResult.error && !validationResult.error.includes("Invalid transaction data")) {
      return res
        .status(validationResult.status)
        .json({ error: validationResult.error });
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      chainId.toString(),
      txHash,
      null,
      null,
      null,
      null
    )

    return res.status(200).json({ success: true });
  } catch (err) {
    if (err.response) {
      console.error(
        { error: err.response.data },
        "Error in paymentV3"
      );
    } else if (err.request) {
      console.error(
        { error: err.request.data },
        "Error in paymentV3"
      );
    } else {
      console.error({ error: err }, "Error in paymentV3");
    }

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * 
 * Allows a user to request a refund for a failed verification session.
 */
async function refund(req, res) {
  const id = req.params.id;
  const to = req.body.to;

  const mutexKey = `sessionRefundMutexLock:${id}`

  try {
    if (!to || to.length !== 42) {
      return res.status(400).json({
        error: "to is required and must be a 42-character hexstring (including 0x)",
      });
    }

    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.Item.sessionStatus.S !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res
        .status(400)
        .json({ error: "Only failed verifications can be refunded." });
    }

    if (session.Item.refundTxHash?.S) {
      return res
        .status(400)
        .json({ error: "Session has already been refunded." });
    }

    // Create mutex. We use mutex here so that only one refund request
    // per session can be processed at a time. Otherwise, if the user
    // spams this refund endpoint, we could send multiple transactions
    // before the first one is confirmed.
    const mutex = await redis.get(mutexKey)
    if (mutex) {
      return res.status(400).json({ error: "Refund already in progress" });
    }
    await redis.set(mutexKey, 'locked', 'EX', 60)

    // Perform refund logic
    const response = await refundMintFeeOnChain(session, to);

    // Delete mutex
    await redis.del(mutexKey)

    // Return response
    return res.status(response.status).json(response.data);
  } catch (err) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      await redis.del(mutexKey)
    } catch (err) {
      console.log("Error encountered while deleting mutex", err);
    }

    console.log("Error encountered", err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 */
async function refundV2(req, res) {
  if (req.body.to) {
    return refund(req, res);
  }

  const id = req.params.id;

  const mutexKey = `sessionRefundMutexLock:${id}`

  try {
    const session = await getPhoneSessionById(id)

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.Item.sessionStatus?.S !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res
        .status(400)
        .json({ error: "Only failed verifications can be refunded." });
    }

    if (session.Item.refundTxHash?.S) {
      return res
        .status(400)
        .json({ error: "Session has already been refunded." });
    }

    // Create mutex. We use mutex here so that only one refund request
    // per session can be processed at a time. Otherwise, if the user
    // spams this refund endpoint, we could send multiple transactions
    // before the first one is confirmed.
    const mutex = await redis.get(mutexKey)
    if (mutex) {
      return res.status(400).json({ error: "Refund already in progress" });
    }
    await redis.set(mutexKey, 'locked', 'EX', 60)

    // Perform refund logic
    const response = await refundMintFeePayPal(session, to);

    // Delete mutex
    await redis.del(mutexKey)

    // Return response
    return res.status(response.status).json(response.data);
  } catch (err) {
    // Delete mutex. We have this here in case an unknown error occurs above.
    try {
      await redis.del(mutexKey)
    } catch (err) {
      console.log("Error encountered while deleting mutex", err);
    }

    if (err.response) {
      console.error(
        { error: JSON.stringify(err.response.data, null, 2) },
        "Error during refund"
      );
    } else if (err.request) {
      console.error(
        { error: JSON.stringify(err.request.data, null, 2) },
        "Error during refund"
      );
    } else {
      console.error({ error: err }, "Error during refund");
    }

    console.log("Error encountered", err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * 
 * Get session(s) associated with sigDigest or id.
 */
async function getSessions(req, res) {
  try {
    const sigDigest = req.query.sigDigest;
    const id = req.query.id;

    if (!sigDigest && !id) {
      return res.status(400).json({ error: "sigDigest or id is required" });
    }

    let sessions;
    if (id) {
      const session = await getPhoneSessionById(id)
      sessions = session?.Item ? [session.Item] : []
    } else {
      const storedSessions = await getPhoneSessionsBySigDigest(sigDigest)
      sessions = storedSessions?.Items ? storedSessions.Items : []
    }

    return res.status(200).json(sessions);
  } catch (err) {
    console.log("GET /sessions: Error:", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * 
 * Allows a user to generate a voucher for bypassing the session payment.
 */
async function generateVoucher(req, res) {
  try {
    const chainId = Number(req.body.chainId);
    const txHash = req.body.txHash;
    const numberOfVouchers = Number(req.body.numberOfVouchers);
    if (!chainId || supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `Missing chainId. chainId must be one of ${supportedChainIds.join(
          ", "
        )}`,
      });
    }
    if (!txHash) {
      return res.status(400).json({ error: "txHash is required" });
    }
    if (!numberOfVouchers || numberOfVouchers < 0) {
      return res.status(400).json({ error: "valid numberOfVouchers is required" });
    }
    const totalAmount = 5 * numberOfVouchers;
    const validationResult = await validateTxForVoucherPayment(chainId, txHash, totalAmount);
    console.log('validationresul', validationResult)
    if (validationResult.error) {
      return res
        .status(validationResult.status)
        .json({ error: validationResult.error });
    }
    const voucherIds = [];
    const voucherItems = [];
    for (let i = 0; i < numberOfVouchers; i++) {
      const id = randomBytes(32).toString('hex');
      voucherIds.push(id);
      voucherItems.push({
        PutRequest: {
          Item: {
            'id': { S: `${id}` },
            'isRedeemed': { BOOL: false },
            'sessionId': { S: `${null}` },
            'txHash': { S: `${txHash}` }
        }
        },
      });
    }
    await batchPutVouchers(voucherItems);
    return res.status(201).json({
      voucherIds,
    });
  } catch (err) {
    console.log("generateVoucher: Error:", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

/**
 * ENDPOINT.
 * 
 * Allows a user to redeem a valid voucher for bypassing the session payment.
 */
async function redeemVoucher(req, res) {
  try {
    const id = req.params.id;
    const voucherId = req.body.voucherId;

    if (!voucherId) {
      return res.status(400).json({ error: "voucherId is required" });
    }

    const session = await getPhoneSessionById(id);

    if (!session?.Item) {
      return res.status(404).json({ error: "Session not found" });
    }

    const voucher = await getVoucherById(voucherId);
    if (!voucher?.Item) {
      return res.status(404).json({ error: "voucher is invalid" });
    }
    if (voucher.Item.isRedeemed.BOOL) {
      return res.status(404).json({ error: "voucher is already redeemed" });
    }
    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      null,
      null,
      null,
      null,
      null,
      null
    )

    await updateVoucher(
      voucherId,
      true,
      id,
      null
    )
    return res.status(200).json({ success: true });
  } catch (err) {
    if (err.response) {
      console.error(
        { error: err.response.data },
        "Error in redeemVoucher"
      );
    } else if (err.request) {
      console.error(
        { error: err.request.data },
        "Error in redeemVoucher"
      );
    } else {
      console.error({ error: err }, "Error in redeemVoucher");
    }

    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

const sessionsRouter = express.Router();

sessionsRouter.post("/", postSession);
sessionsRouter.post("/:id/paypal-order", createPayPalOrder);
sessionsRouter.post("/:id/payment", payment);
sessionsRouter.post("/:id/payment/v2", paymentV2);
sessionsRouter.post("/:id/payment/v3", paymentV3);
sessionsRouter.post("/:id/redeem-voucher", redeemVoucher);
sessionsRouter.post("/:id/refund", refund);
sessionsRouter.post("/:id/refund/v2", refundV2);
sessionsRouter.get("/", getSessions);
sessionsRouter.get("/generate-voucher", generateVoucher);

module.exports.sessionsRouter = sessionsRouter;
