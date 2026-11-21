import { NestFactory, Reflector } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS_ORIGIN is required in production (enforced by env validation); the
  // localhost fallback is for local development only.
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = (process.env.CORS_ORIGIN ?? (isProd ? '' : 'http://localhost:3000'))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
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

  const logger = new Logger('Bootstrap');
  logger.log(`V2E API running on http://localhost:${port}`);
  if (!isProd) logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
