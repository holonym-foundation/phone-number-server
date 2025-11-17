import { ethers } from 'ethers'
import 'dotenv/config'

export const sessionStatusEnum = {
  NEEDS_PAYMENT: 'NEEDS_PAYMENT',
  IN_PROGRESS: 'IN_PROGRESS',
  ISSUED: 'ISSUED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  REFUNDED: 'REFUNDED'
} as const

export type SessionStatus =
  (typeof sessionStatusEnum)[keyof typeof sessionStatusEnum]

export const maxAttemptsPerSession = 3

export const supportedChainIds: number[] = [
  1, // Ethereum
  10, // Optimism
  250, // Fantom
  8453, // Base
  43114, // Avalanche
  1313161554 // Aurora
]
if (process.env.NODE_ENV === 'development') {
  supportedChainIds.push(420) // Optimism goerli
}

// NOTE: This const must stay in sync with the frontend.
// We use the same account that we use for id-server.
export const idServerPaymentAddress =
  '0xdca2e9ae8423d7b0f94d7f9fc09e698a45f3c851'

// const ethereumProvider = new ethers.providers.AlchemyProvider(
//   "homestead",
//   process.env.ALCHEMY_APIKEY
// );
// const optimismProvider = new ethers.providers.AlchemyProvider(
//   "optimism",
//   process.env.ALCHEMY_APIKEY
// );
// const optimismGoerliProvider = new ethers.providers.AlchemyProvider(
//   "optimism-goerli",
//   process.env.ALCHEMY_APIKEY
// );
export const ethereumProvider = new ethers.providers.JsonRpcProvider(
  process.env.ETHEREUM_RPC_URL
)
export const optimismProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_RPC_URL
)
export const optimismGoerliProvider = new ethers.providers.JsonRpcProvider(
  process.env.OPTIMISM_GOERLI_RPC_URL
)
export const baseProvider = new ethers.providers.JsonRpcProvider(
  process.env.BASE_RPC_URL
)
export const fantomProvider = new ethers.providers.JsonRpcProvider(
  'https://rpc.ftm.tools'
)
export const avalancheProvider = new ethers.providers.JsonRpcProvider(
  'https://api.avax.network/ext/bc/C/rpc'
)
export const auroraProvider = new ethers.providers.JsonRpcProvider(
  'https://mainnet.aurora.dev'
)

export const ethereumCMCID = 1027
export const avalancheCMCID = 5805
// const fantomCMCID = 3513;
export const fantomCMCID = 32684 // Sonic

export const cmcSlugToID: Record<string, number> = {
  ethereum: ethereumCMCID,
  avalanche: avalancheCMCID,
  fantom: fantomCMCID
}

export const cmcIdToSlug: Record<number, string> = {
  [ethereumCMCID]: 'ethereum',
  [avalancheCMCID]: 'avalanche',
  [fantomCMCID]: 'fantom'
}

export const ERROR_MESSAGES = {
  OTP_NOT_FOUND: 'OTP not found',
  OTP_DOES_NOT_MATCH: 'OTP does not match',
  TOO_MANY_ATTEMPTS_COUNTRY: 'Too many recent attempts from country',
  TOO_MANY_ATTEMPTS_IP: 'Too many recent attempts from IP address'
} as const

export const payPalApiUrlBase =
  process.env.NODE_ENV === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
