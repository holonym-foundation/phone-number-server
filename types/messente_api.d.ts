declare module 'messente_api' {
  export namespace ApiClient {
    export const instance: any
  }
  export namespace SMS {
    export function constructFromObject(obj: any): any
  }
  export namespace Omnimessage {
    export function constructFromObject(obj: any): any
  }
  export class OmnimessageApi {
    sendOmnimessage(
      omnimessage: any,
      callback: (error: any, data: any, response: any) => void
    ): void
  }
}
