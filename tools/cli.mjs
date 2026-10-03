#!/usr/bin/env node
// Presentify administrative commands (run inside the "tools" container).
//
//   migrate             apply pending database migrations
//   create-superadmin   create a Super Administrator account (interactive or with flags)
//   migration-status    list applied migrations
//   superadmin-count    print the number of active Super Admins (used by the installer)

import { migrate, migrationStatus } from './migrate.mjs';
import { countSuperAdmins, createSuperAdmin } from './superadmin.mjs';

const [command, ...args] = process.argv.slice(2);

const commands = {
  migrate: () => migrate(),
  'migration-status': () => migrationStatus(),
  'create-superadmin': () => createSuperAdmin(args),
  'superadmin-count': () => countSuperAdmins(),
};

const run = commands[command];
if (!run) {
  console.error(`Unknown command "${command ?? ''}". Available: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

try {
  await run();
} catch (err) {
  console.error(`\nERROR: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
