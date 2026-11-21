import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { trustProxySetting } from './common/http/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Real client IP from Caddy / Next.js (common/http/trust-proxy.ts); rate limits depend on it.
  app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',');
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Swagger scans every controller/DTO to build the OpenAPI document. That cost
  // is pure startup overhead in production (the docs aren't served there), so
  // only generate/mount it outside production.
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('V2E API')
      .setDescription('Multi-tenant organizational workspace platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Drain in-flight requests on SIGTERM/SIGINT instead of severing them —
  // otherwise a restart can commit a write and still hand the client a 500.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  // The Next.js dev server proxies /api/* to us over keep-alive sockets whose
  // agent reuses connections idle up to ~5s — exactly Node's default server
  // keepAliveTimeout. When both sides act at once the proxy writes into a
  // socket we're closing and surfaces a spurious 500 (ECONNRESET) to the
  // browser. The server must always close LAST, so hold sockets open well
  // past any client/proxy reuse window.
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  console.log(`V2E API running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
