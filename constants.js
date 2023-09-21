const { ethers } = require('ethers');

const sessionStatusEnum = {
  NEEDS_PAYMENT: "NEEDS_PAYMENT",
  IN_PROGRESS: "IN_PROGRESS",
  ISSUED: "ISSUED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  REFUNDED: "REFUNDED",
};

const maxAttemptsPerSession = 3;

const supportedChainIds = [
  1, // Ethereum
  10, // Optimism
  250, // Fantom
];
if (process.env.NODE_ENV === "development") {
  supportedChainIds.push(420); // Optimism goerli
}

const phoneServerPaymentAddress = "0x50C49b7305ac450CC2D2BA5fA1b1cc3168cd34d5";

const ethereumProvider = new ethers.providers.AlchemyProvider(
  "homestead",
  process.env.ALCHEMY_APIKEY
);
const optimismProvider = new ethers.providers.AlchemyProvider(
  "optimism",
  process.env.ALCHEMY_APIKEY
);
const optimismGoerliProvider = new ethers.providers.AlchemyProvider(
  "optimism-goerli",
  process.env.ALCHEMY_APIKEY
);
const fantomProvider = new ethers.providers.JsonRpcProvider(
  "https://rpc.ftm.tools"
);

const ethereumCMCID = 1027;
const fantomCMCID = 3513;

const cmcSlugToID = {
  ethereum: ethereumCMCID,
  fantom: fantomCMCID,
};

module.exports = {
  sessionStatusEnum,
  maxAttemptsPerSession,
  supportedChainIds,
  phoneServerPaymentAddress,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  ethereumCMCID,
  fantomCMCID,
  cmcSlugToID,
}
