import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOkResponse({
    description: 'Returns a basic API health response.',
    schema: {
      example: {
        success: true,
        statusCode: 200,
        message: 'Request successful',
        data: 'Hello World!',
        path: '/api/v1',
        timestamp: '2026-06-09T00:00:00.000Z',
      },
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
