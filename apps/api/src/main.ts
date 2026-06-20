import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import * as crypto from 'crypto';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

const log = new Logger('bootstrap');

function assertSecretsOrWarn() {
  const env = process.env.NODE_ENV || 'development';
  const dev = ['development', 'test'].includes(env);
  const defaults = {
    JWT_ACCESS_SECRET: 'dev_access_secret_change_me',
    JWT_REFRESH_SECRET: 'dev_refresh_secret_change_me',
  };
  for (const [k, defaultVal] of Object.entries(defaults)) {
    const v = process.env[k];
    if (!v) {
      const msg = `Missing required env var ${k}`;
      if (dev) { log.warn(msg); } else { throw new Error(msg); }
    } else if (v === defaultVal) {
      const msg = `${k} is set to the public default. Rotate it.`;
      if (dev) { log.warn(msg); } else { throw new Error(msg); }
    } else if (v.length < 32) {
      const msg = `${k} is shorter than 32 chars; use a stronger secret.`;
      if (dev) { log.warn(msg); } else { throw new Error(msg); }
    }
  }
  if (!process.env.ENCRYPTION_KEY) {
    const msg = 'ENCRYPTION_KEY not set — falling back to JWT_ACCESS_SECRET for at-rest crypto. Set ENCRYPTION_KEY (64-hex-char random) before production.';
    if (dev) log.warn(msg); else throw new Error(msg);
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_KEY_ID) {
    log.warn('RAZORPAY_KEY_ID is set but RAZORPAY_WEBHOOK_SECRET is not. Webhook delivery will be refused.');
  }
}

async function bootstrap() {
  assertSecretsOrWarn();

  const app = await NestFactory.create(AppModule, { cors: false });

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

  const port = Number(process.env.API_PORT || 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
}

bootstrap();
