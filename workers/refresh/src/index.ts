// Worker entry: only handlers may be exported here (workerd rejects other named exports).
import * as Sentry from '@sentry/cloudflare';
import { runRefresh, type Env } from './run';

const worker: ExportedHandler<Env> = {
  async scheduled(controller, env) {
    if (!env.SENTRY_DSN) console.warn('SENTRY_DSN not set');
    await runRefresh(controller.scheduledTime, env, {
      fetcher: (input, init) => fetch(input, init),
      reporter: {
        warn: (message, key) => {
          console.warn(message);
          Sentry.withScope((scope) => {
            scope.setFingerprint(['refresh', key.localMap, key.part]);
            Sentry.captureMessage(message, 'warning');
          });
        },
        error: (error) => {
          console.error(error);
          Sentry.captureException(error);
        },
      },
      now: () => new Date(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
  },
};

export default Sentry.withSentry<Env>(
  (env) => ({ dsn: env.SENTRY_DSN, tracesSampleRate: 0 }),
  worker,
);
