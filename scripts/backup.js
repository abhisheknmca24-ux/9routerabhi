const { BackupManager } = require('../shared/security/backup-manager');

const backup = new BackupManager({
  projectRoot: __dirname + '/..',
  backupDir: __dirname + '/../backups',
  retentionDays: 30,
  excludeDirs: ['node_modules', 'backups', '.git', 'logs', 'audit'],
});

const result = backup.createBackup();
console.log(`Backup created: ${result.name}`);
console.log(`  Path: ${result.path}`);
console.log(`  Files: ${result.fileCount}`);

const list = backup.listBackups();
console.log(`\nTotal backups: ${list.length}`);
list.forEach(b => console.log(`  ${b.name} (${b.createdAt}) - ${b.fileCount} files`));
