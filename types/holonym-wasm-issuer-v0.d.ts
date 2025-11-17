declare module 'holonym-wasm-issuer-v0' {
  export function issue(
    privkey: string,
    customValue0: string,
    customValue1: string
  ): string
  export function getAddress(privkey: string): string
}
