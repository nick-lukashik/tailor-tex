import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Slots, SlotsBusyError, SpawnToolRunner } from './tools.js'

describe('SpawnToolRunner', () => {
    const runner = new SpawnToolRunner()
    const options = {
        cwd: tmpdir(),
        timeoutMs: 10_000,
    }

    it('passes arguments verbatim, without a shell, and collects both streams', async () => {
        const result = await runner.run(
            process.execPath,
            [
                '-e',
                "process.stdout.write(process.argv[1]); process.stderr.write('!')",
                '\\def\\x{1} $HOME `x` $(id); echo',
            ],
            options,
        )
        expect(result).toEqual({
            code: 0,
            output: '\\def\\x{1} $HOME `x` $(id); echo!',
            timedOut: false,
        })
    })

    it('kills the whole process group of a run past its timeout', async () => {
        const started = Date.now()
        // The child starts a grandchild that would print after 1.5 s if it survived.
        const result = await runner.run(
            process.execPath,
            [
                '-e',
                [
                    "const { spawn } = require('node:child_process')",
                    "spawn(process.execPath, ['-e', 'setTimeout(() => console.log(\"survived\"), 1500)'], { stdio: 'inherit' })",
                    'setTimeout(() => {}, 30000)',
                ].join(';'),
            ],
            {
                ...options,
                timeoutMs: 300,
            },
        )
        expect(result.timedOut).toBe(true)
        expect(result.code).not.toBe(0)
        expect(Date.now() - started).toBeLessThan(1_400)
        await new Promise(resolve => setTimeout(resolve, 1_500))
        expect(result.output).not.toContain('survived')
    })

    it('reports a missing binary as a failed run', async () => {
        const result = await runner.run('no-such-tool-tailor-tex', [], options)
        expect(result.code).toBeNull()
        expect(result.timedOut).toBe(false)
    })
})

describe('Slots', () => {
    it('runs at most `size` jobs, queues `queueMax`, refuses the rest', async () => {
        const slots = new Slots(2, 1)
        const releases: (() => void)[] = []
        let running = 0
        let peak = 0
        const job = () =>
            slots.run(async () => {
                running++
                peak = Math.max(peak, running)
                await new Promise<void>(resolve => releases.push(resolve))
                running--
            })
        const jobs = [
            job(),
            job(),
            job(),
        ]
        await expect
            .poll(() => slots.state)
            .toEqual({
                active: 2,
                waiting: 1,
            })
        await expect(job()).rejects.toBeInstanceOf(SlotsBusyError)
        releases.shift()?.()
        releases.shift()?.()
        await expect.poll(() => releases.length).toBe(1)
        releases.shift()?.()
        await Promise.all(jobs)
        expect(peak).toBe(2)
        expect(slots.state).toEqual({
            active: 0,
            waiting: 0,
        })
    })

    it('frees the slot when a job throws', async () => {
        const slots = new Slots(1, 0)
        await expect(slots.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
        await expect(slots.run(async () => 1)).resolves.toBe(1)
    })
})
