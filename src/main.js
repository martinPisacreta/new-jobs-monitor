import { Actor } from 'apify';
import { main } from './actor.mjs';

await Actor.init();
let exitCode = 0;
try {
  const output = await main(Actor);
  console.log(JSON.stringify({ event: 'run-complete', ...output }));
} catch (error) {
  exitCode = 1;
  console.error('Run stopped after an input, storage or charging failure. Inspect the dataset and charges before restarting; state may not have been committed.');
  console.error(`Cause: ${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`);
} finally {
  await Actor.exit({ exitCode });
}
