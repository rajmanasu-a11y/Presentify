// Edge Functions router — based on the official Supabase self-hosted router
// (supabase/docker/volumes/functions/main), with two Presentify changes:
// folders starting with "_" (shared code) are never served as functions, and
// tokens are verified with Web Crypto instead of a downloaded library.

console.log('main function started')

const MAX_WORKER_RETRIES = 3

const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? ''
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'

export enum RequestErrors {
  InvalidJWT = 'UNAUTHORIZED_INVALID_JWT',
  MissingAuthHeader = 'UNAUTHORIZED_NO_AUTH_HEADER',
  NotFound = 'NOT_FOUND',
  BootError = 'BOOT_ERROR',
  EdgeFunctionError = 'EDGE_FUNCTION_ERROR',
  IdleTimeout = 'IDLE_TIMEOUT',
  WorkerResourceLimit = 'WORKER_RESOURCE_LIMIT',
  WorkerError = 'WORKER_ERROR',
  InvalidResponseStatusCode = 'INVALID_RESPONSE_STATUS_CODE',
}

type FunctionFailure = {
  code: RequestErrors
  message: string
  status: number
}

function getFunctionErrorResponse({ code, message, status }: FunctionFailure): Response {
  return Response.json(
    { code, message },
    {
      status,
      headers: {
        'sb-error-code': code,
        'Access-Control-Expose-Headers': 'sb-error-code',
      },
    }
  )
}

function handleWorkerResponse(response: Response): Response {
  if (response.status < 500) return response
  const headers = new Headers(response.headers)
  headers.set('sb-error-code', RequestErrors.EdgeFunctionError)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function resolveRuntimeError(e: unknown): FunctionFailure {
  // These error classes are supplied by Edge Runtime, rather than stock Deno.
  if (e instanceof Deno.errors.InvalidWorkerCreation) {
    return { code: RequestErrors.BootError, message: 'Function failed to start (please check logs)', status: 503 }
  }
  if (e instanceof Deno.errors.WorkerRequestCancelled) {
    return { code: RequestErrors.WorkerResourceLimit, message: 'Function failed due to not having enough compute resources (please check logs)', status: 546 }
  }
  if (e instanceof Deno.errors.WorkerRequestIdleTimeout) {
    return { code: RequestErrors.IdleTimeout, message: 'Request idle timeout limit (150s) reached', status: 504 }
  }
  if (
    (e instanceof RangeError || e instanceof Deno.errors.InvalidWorkerResponse) &&
    e.message.includes('is not equal to 101 and outside the range [200, 599]')
  ) {
    return { code: RequestErrors.InvalidResponseStatusCode, message: 'Function returned an invalid HTTP status code (please check logs)', status: 500 }
  }
  if (e instanceof Deno.errors.WorkerAlreadyRetired || e instanceof Deno.errors.InvalidWorkerResponse) {
    return { code: RequestErrors.WorkerError, message: 'Function exited due to an error (please check logs)', status: 500 }
  }
  return { code: RequestErrors.EdgeFunctionError, message: 'Internal Server Error', status: 500 }
}

// ---- Token verification (HS256) with the built-in Web Crypto API ------------
// Presentify change: no external JWT library, so functions never download code
// at run time (important on servers without internet access).

function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

let hmacKey: Promise<CryptoKey> | null = null
function getKey(): Promise<CryptoKey> {
  hmacKey ??= crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return hmacKey
}

async function verifyJwt(token: string): Promise<boolean> {
  if (!JWT_SECRET) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])))
    if (header.alg !== 'HS256') return false
    const valid = await crypto.subtle.verify('HMAC', await getKey(), base64UrlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
    if (!valid) return false
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])))
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return false
    return true
  } catch {
    return false
  }
}

function unauthorized(code: RequestErrors, message: string): Response {
  return Response.json({ code, message, msg: message }, {
    status: 401,
    headers: { 'sb-error-code': code, 'Access-Control-Expose-Headers': 'sb-error-code' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'OPTIONS' && VERIFY_JWT) {
    const auth = req.headers.get('authorization') ?? ''
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim())
    if (!match) return unauthorized(RequestErrors.MissingAuthHeader, 'Missing authorization header')
    if (!(await verifyJwt(match[1]))) return unauthorized(RequestErrors.InvalidJWT, 'Invalid JWT')
  }

  const url = new URL(req.url)
  const { pathname } = url
  const path_parts = pathname.split('/')
  const service_name = path_parts[1]

  if (!service_name || service_name.startsWith('_') || !/^[a-z0-9-]+$/.test(service_name)) {
    return getFunctionErrorResponse({
      code: RequestErrors.NotFound,
      message: 'Requested function was not found',
      status: 404,
    })
  }

  const servicePath = `/home/deno/functions/${service_name}`
  console.error(`serving the request with ${servicePath}`)

  try {
    const serviceInfo = await Deno.stat(servicePath)
    if (!serviceInfo.isDirectory) {
      return getFunctionErrorResponse({
        code: RequestErrors.NotFound,
        message: 'Requested function was not found',
        status: 404,
      })
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return getFunctionErrorResponse({
        code: RequestErrors.NotFound,
        message: 'Requested function was not found',
        status: 404,
      })
    }
    console.error(e)
    return getFunctionErrorResponse({
      code: RequestErrors.BootError,
      message: 'Function failed to start (please check logs)',
      status: 503,
    })
  }

  const memoryLimitMb = 150
  // Keep the wall clock above the 150s request idle timeout configured in Compose.
  const workerTimeoutMs = 400_000
  const requestAbsentTimeoutMs = 60_000
  const noModuleCache = false
  // Using a common Import Map for all functions 
  // to use a scope 'deno.json' it must be dinamically resolved base on the 'service_name'
  const importMapPath = `/home/deno/functions/deno.jsonc`
  // SUPABASE_FUNCTION_SLUG is listed after the container env snapshot so
  // nothing in it can shadow the value, and it is per-request because only this
  // worker knows which function the request resolved to.
  const envVarsObj = { ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: service_name }
  const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]])

  const callWorker = async (req: Request, retriesLeft = MAX_WORKER_RETRIES): Promise<Response> => {
    // Preserve the body before fetch() can consume it, even on a failed attempt.
    // Must run before `new Request(req)` below, which takes over the body.
    // The unread retry branch can buffer the entire body in main-worker memory,
    // even when the first attempt succeeds.
    const retryReq = retriesLeft > 0 ? req.clone() : null

    try {
      const worker = await EdgeRuntime.userWorkers.create({
        servicePath,
        memoryLimitMb,
        workerTimeoutMs,
        context: { supervisor: { requestAbsentTimeoutMs } },
        noModuleCache,
        importMapPath,
        envVars,
      })
      const userReq = new Request(req)
      EdgeRuntime.applySupabaseTag(req, userReq)
      return handleWorkerResponse(await worker.fetch(userReq))
    } catch (e) {
      // Retirement rejects before dispatch, so user code has not run yet.
      if (e instanceof Deno.errors.WorkerAlreadyRetired && retryReq) {
        console.warn(`${service_name}: worker retired before dispatch; retrying (${retriesLeft} left)`)
        // Request.clone() does not copy the tag that connects streaming to the client.
        EdgeRuntime.applySupabaseTag(req, retryReq)
        return await callWorker(retryReq, retriesLeft - 1)
      }

      console.error(e)
      return getFunctionErrorResponse(resolveRuntimeError(e))
    }
  }

  return await callWorker(req)
})
