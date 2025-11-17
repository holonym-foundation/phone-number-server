import assert from 'assert'
import axios from 'axios'
import {
  ethereumCMCID,
  fantomCMCID,
  avalancheCMCID,
  cmcIdToSlug
} from './constants.js'

export function getDateAsInt(date: string): number {
  // Format input
  const [year, month, day] = date.split('-')
  assert.ok(year && month && day) // Make sure Y M D all given
  assert.ok(parseInt(year) >= 1900 && parseInt(year) <= 2099) // Make sure date is in a reasonable range, otherwise it's likely the input was malformatted and it's best to be safe by stopping -- we can always allow more edge cases if needed later
  const time = new Date(date).getTime() / 1000 + 2208988800 // 2208988800000 is 70 year offset; Unix timestamps below 1970 are negative and we want to allow from approximately 1900.
  assert.ok(!isNaN(time))
  return time
}

// --------------------- Coinmarketcap stuff ---------------------
// TODO: Use redis instead. This is a temporary solution to avoid hitting
// CMC's rate limit. key-value pair is { slug: { price: number, lastUpdatedAt: Date } }
interface CryptoPriceCache {
  price: number
  lastUpdatedAt: Date
}

const cryptoPricesCache: Record<string, CryptoPriceCache> = {}

function getPriceFromCache(slug: string): number | undefined {
  const now = new Date()
  const cachedPrice = cryptoPricesCache[slug]
  // If price was last updated less than 30 seconds ago, use cached price
  if (
    cachedPrice &&
    now.getTime() - cachedPrice.lastUpdatedAt.getTime() < 30 * 1000
  ) {
    return cachedPrice.price
  }
  return undefined
}

function setPriceInCache(slug: string, price: number): void {
  cryptoPricesCache[slug] = { price, lastUpdatedAt: new Date() }
}

function getLatestCryptoPrice(id: number) {
  return axios.get(
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${id}`,
    {
      headers: {
        'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY,
        Accept: 'application/json'
      }
    }
  )
}

/**
 * First, check the cache. If nothing in cache, query CMC, and update cache.
 */
export async function getPriceFromCacheOrAPI(id: number): Promise<number> {
  const slug = cmcIdToSlug[id]
  const cachedPrice = getPriceFromCache(slug)
  if (cachedPrice) {
    return cachedPrice
  }
  const resp = await getLatestCryptoPrice(id)
  const price = resp?.data?.data?.[id]?.quote?.USD?.price
  setPriceInCache(slug, price)
  return price
}

export async function usdToETH(usdAmount: number): Promise<number> {
  const ethPrice = await getPriceFromCacheOrAPI(ethereumCMCID)
  const ethAmount = usdAmount / ethPrice
  return ethAmount
}

export async function usdToFTM(usdAmount: number): Promise<number> {
  const fantomPrice = await getPriceFromCacheOrAPI(fantomCMCID)
  const ftmAmount = usdAmount / fantomPrice
  return ftmAmount
}

export async function usdToAVAX(usdAmount: number): Promise<number> {
  const avalanchePrice = await getPriceFromCacheOrAPI(avalancheCMCID)
  const avaxAmount = usdAmount / avalanchePrice
  return avaxAmount
}

// --------------------- END: Coinmarketcap stuff ---------------------

/**
 * @param fn - Function to retry
 * @param retries - Number of retries remaining
 * @param delay - Delay in milliseconds between retries
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries === 0) {
      throw err
    }

    const error = err as Error
    console.log(
      'retry encountered error "',
      error.message,
      '" retries left:',
      retries
    )

    // console.log(`Retrying... Attempts left: ${retries}`)
    await new Promise((resolve) => setTimeout(resolve, delay))

    return await retry(fn, retries - 1, delay)
  }
}

/**
 * @param timestamp - Unix timestamp in milliseconds
 */
export function timestampIsWithinLast5Days(
  timestamp: number | string | undefined
): boolean {
  if (!timestamp) return false
  const timestampNum =
    typeof timestamp === 'string' ? parseInt(timestamp) : timestamp
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).getTime()
  return timestampNum >= fiveDaysAgo
}
