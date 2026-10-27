import type { AccountStatus } from "./account";

/** What the bridge calls on a screen adapter. */
export interface Screen {
  command(raw: string): unknown;
  /** Follows the signed-in user. */
  session?(status: AccountStatus, userId: string): void;
}

/** A screen adapter whose code loads with its first command. Commands that arrive meanwhile run
 * in order once it has loaded; a failed load drops them, and the next command tries again. */
export class LazyScreen<T extends Screen> implements Screen {
  private screen: T | undefined;
  private loading: Promise<void> | undefined;
  private queued: string[] = [];
  private lastSession: [AccountStatus, string] | undefined;

  constructor(
    private load: () => Promise<T>,
    private failed: (error: unknown) => void,
  ) {}

  command(raw: string): unknown {
    if (this.screen) return this.screen.command(raw);
    this.queued.push(raw);
    this.loading ??= this.load().then(
      (screen) => {
        this.screen = screen;
        if (this.lastSession) screen.session?.(...this.lastSession);
        for (const queued of this.queued.splice(0)) void screen.command(queued);
      },
      (error: unknown) => {
        this.loading = undefined;
        this.queued = [];
        this.failed(error);
      },
    );
    return this.loading;
  }

  session(status: AccountStatus, userId: string) {
    if (this.screen) this.screen.session?.(status, userId);
    else this.lastSession = [status, userId];
  }
}
