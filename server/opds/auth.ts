import { basicAuth } from 'hono/basic-auth'
import type { MiddlewareHandler } from 'hono'
import type { OpdsAuth } from './types'

export function createOpdsAuth(auth?: OpdsAuth): MiddlewareHandler {
  if (!auth) {
    return async (_context, next) => next()
  }

  return basicAuth({
    ...auth,
    realm: 'XTC.js OPDS',
  })
}
