import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import express from 'express';
import * as http from 'http';
import * as crypto from 'crypto';

// Nothing heavy is imported at the top of this file on purpose.
//
// A static `import { AppModule }` pulls the whole ~1550-file module graph before the
// first line of bootstrap() runs, which spends the startup budget before the port can
// be bound — measured at 2338ms to bind with static imports, against a 3000ms limit.
// Everything below the listen() call is loaded with `await import(...)` instead, so the
// port opens first and the application is assembled afterwards.

// Make Prisma BigInt columns (e.g. PlatformUser.lastTotpStep) JSON-serializable
// app-wide. Without this, JSON.stringify throws "Do not know how to serialize a
// BigInt" on any non-null BigInt field that reaches a response.
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

// Plain console rather than Nest's Logger: this runs before @nestjs/common is loaded.
const log = {
  info: (m: string) => console.log(`[bootstrap] ${m}`),
  warn: (m: string) => console.warn(`[bootstrap] ${m}`),
  error: (m: string, stack?: string) => console.error(`[bootstrap] ${m}${stack ? '\n' + stack : ''}`),
};

function assertSecretsOrWarn() {
  const env = process.env.NODE_ENV || 'development';
  const dev = ['development', 'test'].includes(env);
  const fail = (msg: string) => { if (dev) { log.warn(msg); } else { throw new Error(msg); } };

  const knownDefaults: Record<string, string> = {
    JWT_ACCESS_SECRET: 'dev_access_secret_change_me',
    JWT_REFRESH_SECRET: 'dev_refresh_secret_change_me',
  };

  // Every at-rest / auth secret is REQUIRED, must be strong (>=32 chars), and
  // must not be a known public default. In dev these only warn (so local boot is
  // not blocked); in production they throw (fail closed). ENCRYPTION_KEY keeps a
  // dev fallback in crypto.ts, but production must set it explicitly.
  // JWT_MFA_TICKET_SECRET + OTP_PEPPER are new for MFA and have NO fallback.
  const required = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_MFA_TICKET_SECRET', 'OTP_PEPPER', 'ENCRYPTION_KEY'];
  for (const k of required) {
    const v = process.env[k];
    if (!v) { fail(`Missing required env var ${k}`); continue; }
    if (knownDefaults[k] && v === knownDefaults[k]) fail(`${k} is set to the public default. Rotate it.`);
    else if (v.length < 32) fail(`${k} is shorter than 32 chars; use a stronger secret.`);
  }

  // All auth secrets must be pairwise DISTINCT. Sharing one (e.g. reusing the
  // access secret for MFA tickets, or the OTP pepper for the encryption key)
  // collapses the separation those secrets exist to provide.
  const seen = new Map<string, string>();
  for (const k of required) {
    const v = process.env[k];
    if (!v) continue;
    const prior = seen.get(v);
    if (prior) fail(`${k} must be a distinct secret (it currently equals ${prior}).`);
    else seen.set(v, k);
  }

  if (!process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_KEY_ID) {
    log.warn('RAZORPAY_KEY_ID is set but RAZORPAY_WEBHOOK_SECRET is not. Webhook delivery will be refused.');
  }
}

/**
 * Bind the port before building the application.
 *
 * Managed Node hosting gives a process a few seconds to start listening and kills it if
 * it does not — Hostinger's window is 3 seconds, measured and confirmed by them as not
 * configurable. This API needs about 3.05s to reach `listen()` on an idle machine: 1.4s
 * to load a ~1550-file module graph and the rest for Nest to wire ~250 routes. Neither
 * is removable, and deferring the Prisma connect saves nothing (measured: 30ms).
 *
 * So the order is inverted. An Express instance starts listening immediately, and Nest is
 * attached to that same instance afterwards with `init()` rather than `listen()`. The
 * port is open in milliseconds; the application arrives a few seconds later.
 *
 * Requests that land in that gap get 503 with Retry-After rather than a 404 from an
 * Express app with no routes yet — a 404 would tell a caller the endpoint does not
 * exist, which is a different and wrong answer.
 */
async function bootstrap() {
  // Stays first: it throws on weak or missing secrets in production, and binding a port
  // for a process that is about to abort would advertise a service that will never come up.
  assertSecretsOrWarn();

  // Report the connection the process actually received, without the password. A hosting
  // panel showing one value while the running app uses another is otherwise invisible,
  // and "authentication failed" alone does not say which credentials were tried.
  for (const key of ['DATABASE_URL', 'CATALOG_DATABASE_URL']) {
    const raw = process.env[key];
    if (!raw) { log.warn(`${key} is NOT SET`); continue; }
    try {
      const u = new URL(raw);
      log.info(`${key} -> user=${u.username} host=${u.hostname}:${u.port || '5432'} db=${u.pathname.slice(1)}`);
    } catch {
      log.warn(`${key} is set but is not a parseable URL`);
    }
  }

  const server = express();
  let ready = false;

  server.use((_req: any, res: any, next: any) => {
    if (ready) return next();
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Starting up, retry shortly',
    });
  });

  // PORT first: managed Node hosting assigns a port and routes its proxy at it, so
  // ignoring it means the app binds somewhere the proxy never looks and every request
  // 502s while the process itself looks healthy. API_PORT stays as the local-development
  // knob and the fallback for platforms that inject nothing.
  const port = Number(process.env.PORT || process.env.API_PORT || 4000);
  const httpServer = http.createServer(server);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, resolve);
  });
  // The elapsed figure is the number that matters on a host with a bind deadline — it
  // says how much of the budget was spent, without anyone having to reproduce it.
  log.info(`port ${port} bound after ${Math.round(process.uptime() * 1000)}ms; loading application`);

  // Everything below this line is deferred until the port is open. These imports are
  // what cost 1.4s; running them here rather than at module scope is the whole point.
  const [
    { NestFactory },
    { ValidationPipe },
    { ExpressAdapter },
    { SwaggerModule, DocumentBuilder },
    { default: helmet },
    { AppModule },
    { AllExceptionsFilter },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/common'),
    import('@nestjs/platform-express'),
    import('@nestjs/swagger'),
    import('helmet'),
    import('./app.module'),
    import('./common/all-exceptions.filter'),
  ]);
  const { json, urlencoded } = express;

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { cors: false });

  // Honour X-Forwarded-* from the configured number of trusted reverse-proxy hops
  // so req.ip / rate limiting / IPv6 truncation work behind load balancers.
  const trustProxy = process.env.TRUST_PROXY_HOPS;
  if (trustProxy !== undefined) {
    const httpAdapter: any = app.getHttpAdapter().getInstance();
    httpAdapter.set?.('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.use((req: any, res: any, next: any) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  });

  // Strict global CSP for every route is registered FIRST so it runs first in
  // the middleware chain. The /docs override below is registered second so it
  // runs *after* the strict one and replaces its CSP / COOP headers for the
  // Swagger UI bundle only. (Helmet uses setHeader, so the second call wins.)
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'connect-src': ["'self'", ...(process.env.WEB_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean)],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
  }));

  // Loose CSP for the Swagger UI only — needs inline style/script for the
  // SwaggerUI bundle. Registered second so its headers override the strict
  // ones above for /docs and /docs/* requests.
  app.use('/docs', helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  }));

  app.use(json({
    limit: '1mb',
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // Normalised CORS allowlist — strip whitespace and trailing slashes so misconfigured
  // env vars don't silently grant access to wrong origins.
  const corsAllow = (process.env.WEB_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / curl
      cb(null, corsAllow.includes(origin.replace(/\/+$/, '')));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger UI is exposed in non-production environments only. In production set
  // SWAGGER_ENABLED=1 to re-enable; consider putting it behind auth via a reverse proxy.
  const swaggerOn =
    process.env.SWAGGER_ENABLED === '1' ||
    (process.env.NODE_ENV || 'development') !== 'production';
  if (swaggerOn) {
    const config = new DocumentBuilder()
      .setTitle('AssetMon API')
      .setDescription('Multi-tenant office asset management')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, doc);
  }

  // GlobalPrismaService.onModuleDestroy() calls $disconnect(), but Nest only runs
  // that hook if shutdown hooks are enabled. Without this, SIGTERM kills the
  // process outright and the database connections are left for the server to reap
  // — which matters on hosting that restarts the app routinely.
  app.enableShutdownHooks();

  // init(), not listen() — the server bound the port before any of this ran.
  await app.init();
  ready = true;
  log.info(`ready on port ${port} after ${Math.round(process.uptime() * 1000)}ms`);
}

bootstrap().catch((err) => {
  // Without this the process can sit with a bound port and a half-built application,
  // answering 503 forever instead of failing and letting the platform restart it.
  log.error(`[api] failed to start: ${err?.message || err}`, err?.stack);
  process.exit(1);
});
