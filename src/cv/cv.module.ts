import { Module } from '@nestjs/common'
import { InternalTokenGuard } from '../auth/internal-token.guard.js'
import { CvController } from './cv.controller.js'
import { CvService } from './cv.service.js'
import { SpawnToolRunner, TOOL_RUNNER } from './tools.js'

/** CvDocument → PDF with XeLaTeX, measured with poppler. */
@Module({
    controllers: [
        CvController,
    ],
    providers: [
        CvService,
        InternalTokenGuard,
        {
            provide: TOOL_RUNNER,
            useClass: SpawnToolRunner,
        },
    ],
})
export class CvModule {}
