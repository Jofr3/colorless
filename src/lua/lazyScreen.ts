import type { AccountStatus } from "./account";

/** What the bridge calls on a screen adapter. */
export interface Screen {
  command(raw: string): unknown;
  /** Follows the signed-in user. */
  session?(status: AccountStatus, userId: string): void;
}

export interface LazyScreenOptions {
  /** Answers a command without the screen's code when it can, returning true; such a command
   * neither loads the screen nor waits for it. */
  answer?: (raw: string) => boolean;
}

/** A screen adapter whose code loads with its first command. Commands that arrive meanwhile run
 * in order once it has loaded; a failed load drops them, and the next command tries again.
 * `warm()` starts the load ahead of the first command, for a page that will likely need it. */
export class LazyScreen<T extends Screen> implements Screen {
  private screen: T | undefined;
  private loading: Promise<void> | undefined;
  private queued: string[] = [];
  private lastSession: [AccountStatus, string] | undefined;

  constructor(
    private load: () => Promise<T>,
    private failed: (error: unknown) => void,
    private options: LazyScreenOptions = {},
  ) {}

  command(raw: string): unknown {
    if (this.options.answer?.(raw)) return true;
    if (this.screen) return this.screen.command(raw);
    this.queued.push(raw);
    return this.start();
  }

  /** Loads the screen's code without a command. A warm-up that fails stays quiet: only a command
   * waiting on the load reports it, and the next command tries again. */
  warm(): Promise<void> {
    return this.screen ? Promise.resolve() : this.start();
  }

  private start(): Promise<void> {
    this.loading ??= this.load().then(
      (screen) => {
        this.screen = screen;
        if (this.lastSession) screen.session?.(...this.lastSession);
        for (const queued of this.queued.splice(0)) void screen.command(queued);
      },
      (error: unknown) => {
        this.loading = undefined;
        const dropped = this.queued.splice(0);
        if (dropped.length > 0) this.failed(error);
      },
    );
    return this.loading;
  }

  session(status: AccountStatus, userId: string) {
    if (this.screen) this.screen.session?.(status, userId);
    else this.lastSession = [status, userId];
  }
}

/** What Lua says when the table's code cannot load because the browser is offline. */
export const TABLE_OFFLINE = "You're offline. Check your connection, then try again.";

/** What to do when a screen chunk will not load. Online, it most likely went away with a deploy
 * under this tab: `reload` onto the new build (the bridge throttles that to once a minute, so a
 * broken build cannot loop). Offline, a reload would only swap the page for the browser's error
 * page: keep the page and tell Lua, so the next click tries the chunk again. */
export function loadFailureHandler(deps: {
  offline: () => boolean;
  reload: () => void;
  notice: (message: string) => void;
  report: (error: unknown) => void;
}): (error: unknown) => void {
  return (error) => {
    deps.report(error);
    if (deps.offline()) deps.notice(TABLE_OFFLINE);
    else deps.reload();
  };
}
