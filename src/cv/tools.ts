import { spawn } from 'node:child_process'
import { Injectable } from '@nestjs/common'

export type ToolResult = {
    /** Exit code; null when the process was killed or did not start. */
    code: number | null
    /** stdout and stderr together, the last 256 KB. */
    output: string
    timedOut: boolean
}

export type ToolOptions = {
    cwd: string
    timeoutMs: number
    env?: NodeJS.ProcessEnv
}

/** Runs xelatex and poppler; replaced by a fake in the HTTP tests. */
export type ToolRunner = {
    run(command: string, args: string[], options: ToolOptions): Promise<ToolResult>
}
export const TOOL_RUNNER = Symbol('TOOL_RUNNER')

const OUTPUT_LIMIT = 256 * 1024

/**
 * Spawns without a shell (arguments pass verbatim, backslashes included).
 * The child leads its own process group: on a timeout the whole group is
 * killed, since xelatex pipes its output into xdvipdfmx, which must not
 * outlive it.
 */
@Injectable()
export class SpawnToolRunner implements ToolRunner {
    run(command: string, args: string[], options: ToolOptions) {
        return new Promise<ToolResult>(resolve => {
            const child = spawn(command, args, {
                cwd: options.cwd,
                env: options.env ?? process.env,
                stdio: [
                    'ignore',
                    'pipe',
                    'pipe',
                ],
                shell: false,
                detached: true,
            })
            let output = ''
            let timedOut = false
            const collect = (chunk: Buffer) => {
                output += chunk.toString('utf8')
                if (output.length > OUTPUT_LIMIT * 2) output = output.slice(-OUTPUT_LIMIT)
            }
            child.stdout.on('data', collect)
            child.stderr.on('data', collect)
            const timer = setTimeout(() => {
                timedOut = true
                try {
                    if (child.pid) process.kill(-child.pid, 'SIGKILL')
                    else child.kill('SIGKILL')
                } catch {
                    child.kill('SIGKILL')
                }
            }, options.timeoutMs)
            child.on('error', error => {
                clearTimeout(timer)
                resolve({
                    code: null,
                    output: `${output}${error.message}`,
                    timedOut,
                })
            })
            child.on('close', code => {
                clearTimeout(timer)
                resolve({
                    code,
                    output: output.slice(-OUTPUT_LIMIT),
                    timedOut,
                })
            })
        })
    }
}

/** Every slot is taken and the queue is full. */
export class SlotsBusyError extends Error {
    constructor() {
        super('All TeX build slots are busy, retry later')
        this.name = 'SlotsBusyError'
    }
}

/** At most `size` jobs at once, at most `queueMax` waiting, first come first served. */
export class Slots {
    private active = 0
    private readonly waiting: (() => void)[] = []

    constructor(
        private readonly size: number,
        private readonly queueMax: number,
    ) {}

    get state() {
        return {
            active: this.active,
            waiting: this.waiting.length,
        }
    }

    async run<T>(work: () => Promise<T>): Promise<T> {
        if (this.active < this.size) this.active++
        else {
            if (this.waiting.length >= this.queueMax) throw new SlotsBusyError()
            // The finishing job hands its slot over: `active` stays the same.
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        try {
            return await work()
        } finally {
            const next = this.waiting.shift()
            if (next) next()
            else this.active--
        }
    }
}
