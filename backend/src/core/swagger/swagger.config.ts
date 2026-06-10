import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  API_PREFIX,
  API_VERSION,
  SWAGGER_PATH,
} from '../../common/constants/app.constants';

export const setupSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('Backend Nest API')
    .setDescription('API documentation for the Next.js backend.')
    .setVersion('1.0')
    .addServer(`/${API_PREFIX}/${API_VERSION}`, 'Versioned API')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
  });
};
