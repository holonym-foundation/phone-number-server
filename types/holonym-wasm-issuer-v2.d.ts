declare module 'holonym-wasm-issuer-v2' {
  export function issue(
    privkey: string,
    nullifier: string,
    customValue0: string,
    customValue1: string
  ): string
  export function getAddress(privkey: string): string
}
