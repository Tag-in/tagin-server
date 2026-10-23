import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH, SWAGGER_PATH } from './swagger.constants.js';

export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('TAG→IN API')
    .setDescription('TAG→IN 서버 API 문서')
    .setVersion('0.0.1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      ACCESS_TOKEN_AUTH,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      tagsSorter: 'alpha',
    },
  });
}
