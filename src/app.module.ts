import { Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { HealthModule } from './common/health/health.module.js'
import { createLoggerModule } from './common/logging/logger.module.js'
import { MetricsModule } from './common/metrics/metrics.module.js'
import { appConfig } from './config/config.js'
import { AppConfigModule } from './config/config.module.js'
import { CvModule } from './cv/cv.module.js'

type App = ConfigType<typeof appConfig>

/** No database, queue or user auth: internal endpoints behind a service token. */
@Module({
    imports: [
        AppConfigModule,
        createLoggerModule({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                service: app.service,
                version: app.version,
                level: app.logLevel,
            }),
        }),
        HealthModule.forRootAsync({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                shutdownDelayMs: app.shutdownDelayMs,
            }),
        }),
        MetricsModule.forRootAsync({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                service: app.service,
                version: app.version,
                port: app.metricsPort,
            }),
        }),
        CvModule,
    ],
})
export class AppModule {}
