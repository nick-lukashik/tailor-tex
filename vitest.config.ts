import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    // SWC emits decorator metadata (Nest DI); Vite's own transform does not.
    plugins: [
        swc.vite({
            module: {
                type: 'es6',
            },
        }),
    ],
    test: {
        restoreMocks: true,
        projects: [
            {
                test: {
                    name: 'unit',
                    include: [
                        'src/**/*.test.ts',
                    ],
                },
            },
            {
                test: {
                    name: 'integration',
                    include: [
                        'test/**/*.test.ts',
                    ],
                    // One app per file; the TeX tests (skipped without xelatex) take seconds each.
                    fileParallelism: false,
                    testTimeout: 60_000,
                    hookTimeout: 60_000,
                },
            },
        ],
    },
})
