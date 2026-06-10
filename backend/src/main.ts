import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, API_VERSION } from './common/constants/app.constants';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { setupSwagger } from './core/swagger/swagger.config';

const parseCorsOrigins = (origin?: string) => {
  if (!origin) {
    return true;
  }

  return origin.split(',').map((value) => value.trim());
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix(`${API_PREFIX}/${API_VERSION}`);
  app.enableCors({
    origin: parseCorsOrigins(configService.get<string>('CORS_ORIGIN')),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  setupSwagger(app);

  await app.listen(configService.getOrThrow<number>('PORT'));
}
bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
