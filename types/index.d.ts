export type BackstageKind = 'agent' | 'shell' | 'monitor'
export type BackstageStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

/** One subagent or background task the session started, as the line and the pane draw it. */
export type BackstageItem = {
  /** The agent's id for a subagent; the task id for a shell or a monitor. */
  id: string
  kind: BackstageKind
  /** The few words the call gave (the Agent call's description, the Bash or Monitor description). */
  title: string
  /** The subagent's type (Explore, Plan, ...); absent for a task. */
  type?: string
  /** The shell command a task runs. */
  command?: string
  status: BackstageStatus
  startedAt: number
  endedAt?: number
  /** Tool calls a subagent has made. */
  steps: number
  /** What it is doing now, or how it ended. */
  step: string
  /** The last three steps, oldest first. */
  recent: string[]
  /** Events a monitor has reported. */
  events?: number
  /** Ended only by a guess (missing from the in-flight list at a stop); its own notification may still correct it. */
  guessed?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    backstage: {
      items: Shaped<BackstageItem[]>
      now: number
      showDone: boolean
      open: string | null
      ticker: string
      /** True once the person closed the pane while work ran: it stays shut until all of it ends. */
      dismissed: boolean
    }
  }
}
