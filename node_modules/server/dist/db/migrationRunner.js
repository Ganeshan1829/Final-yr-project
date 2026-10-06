import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export function runMigrations(database) {
    // Ensure schema_migrations table exists
    database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
    const migrationsDir = path.resolve(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        return;
    }
    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    const getMigrationStmt = database.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const insertMigrationStmt = database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
    for (const file of files) {
        const row = getMigrationStmt.get(file);
        if (!row) {
            const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
            database.exec('BEGIN TRANSACTION;');
            try {
                database.exec(sqlContent);
                insertMigrationStmt.run(file, new Date().toISOString());
                database.exec('COMMIT;');
            }
            catch (err) {
                database.exec('ROLLBACK;');
                throw new Error(`Failed to apply migration ${file}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
}
