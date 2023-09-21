const { randomBytes } = require('crypto');
const express = require("express");
const { createClient } = require('redis');
const { ethers } = require('ethers');
const {
  putPhoneSession,
  updatePhoneSession,
  getPhoneSessionById,
  getPhoneSessionsBySigDigest,
  getPhoneSessionByTxHash,
} = require('./dynamodb.js');
const {
  sessionStatusEnum,
  supportedChainIds,
  phoneServerPaymentAddress,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
} = require('./constants.js');
const { usdToETH, usdToFTM } = require('./utils.js');

const redis = createClient();
redis.on('error', err => console.log('Redis Client Error', err));
redis.connect();

/**
 * Check blockchain for tx.
 * - Ensure recipient of tx is id-server's address.
 * - Ensure amount is > desired amount.
 * - Ensure tx is confirmed.
 */
async function validateTxForSessionPayment(chainId, txHash) {
  let tx;
  if (chainId === 1) {
    tx = await ethereumProvider.getTransaction(txHash);
  } else if (chainId === 10) {
    tx = await optimismProvider.getTransaction(txHash);
  } else if (chainId === 250) {
    tx = await fantomProvider.getTransaction(txHash);
  } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    tx = await optimismGoerliProvider.getTransaction(txHash);
  }

  if (!tx) {
    return {
      status: 400,
      error: "Could not find transaction with given txHash",
    };
  }

  if (phoneServerPaymentAddress !== tx.to.toLowerCase()) {
    return {
      status: 400,
      error: `Invalid transaction recipient. Recipient must be ${phoneServerPaymentAddress}`,
    };
  }

  // NOTE: This const must stay in sync with the frontend.
  // We allow a 2% margin of error.
  const expectedAmountInUSD = 8.0 * 0.98;

  let expectedAmountInToken;
  if ([1, 10].includes(chainId)) {
    expectedAmountInToken = await usdToETH(expectedAmountInUSD);
  } else if (chainId === 250) {
    expectedAmountInToken = await usdToFTM(expectedAmountInUSD);
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

  const sessions = await getPhoneSessionByTxHash(txHash)
  const session = sessions?.Items?.[0]

  if (session) {
    return {
      status: 400,
      error: "Transaction has already been used to pay for a session",
    };
  }

  return {};
}

async function refundMintFee(session, to) {
  let provider;
  if (session.Item.chainId.N === 1) {
    provider = ethereumProvider;
  } else if (session.Item.chainId.N === 10) {
    provider = optimismProvider;
  } else if (session.Item.chainId.N === 250) {
    provider = fantomProvider;
  } else if (process.env.NODE_ENV === "development" && session.Item.chainId.N === 420) {
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

  const txResponse = await wallet.sendTransaction({
    to: to,
    value: refundAmount,
  });

  const receipt = await txResponse.wait();

  await updatePhoneSession(
    session.Item.id.S,
    null,
    sessionStatusEnum.REFUNDED,
    null,
    null,
    null,
    receipt.transactionHash
  )

  return {
    status: 200,
    data: {
      txReceipt: receipt,
    },
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
    )

    return res.status(201).json({ 
      id,
      sigDigest,
      status: sessionStatusEnum.NEEDS_PAYMENT,
      numAttempts: 0,
    });
  } catch (err) {
    console.log("Error encountered", err.message);
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

    const validationResult = await validateTxForSessionPayment(chainId, txHash);
    if (validationResult.error) {
      return res
        .status(validationResult.status)
        .json({ error: validationResult.error });
    }

    await updatePhoneSession(
      id,
      null,
      sessionStatusEnum.IN_PROGRESS,
      chainId,
      txHash,
      null,
      null
    )
  } catch (err) {
    console.error("Error creating session:", err);
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

    if (session.Item.status.S !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res
        .status(400)
        .json({ error: "Only failed verifications can be refunded." });
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
    const response = await refundMintFee(session, to);

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
    console.log("GET /sessions: Error encountered", err.message);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

const sessionsRouter = express.Router();

sessionsRouter.post("/", postSession);
sessionsRouter.post("/:_id/payment", payment);
sessionsRouter.post("/:_id/refund", refund);
sessionsRouter.get("/", getSessions);

module.exports.sessionsRouter = sessionsRouter;
