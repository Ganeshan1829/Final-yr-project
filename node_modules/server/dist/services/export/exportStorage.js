import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Export storage directory: server/exports
export const EXPORTS_DIR = path.resolve(__dirname, '../../../exports');
/**
 * Ensures the exports directory exists and runs the 7-day retention cleanup.
 */
export function ensureExportsDir() {
    if (!fs.existsSync(EXPORTS_DIR)) {
        fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }
    cleanOldExports(7);
    return EXPORTS_DIR;
}
/**
 * Deletes files in exports directory older than maxDays.
 */
export function cleanOldExports(maxDays = 7) {
    try {
        if (!fs.existsSync(EXPORTS_DIR))
            return;
        const now = Date.now();
        const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(EXPORTS_DIR);
        for (const f of files) {
            const fullPath = path.join(EXPORTS_DIR, f);
            try {
                const stats = fs.statSync(fullPath);
                if (now - stats.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(fullPath);
                }
            }
            catch { }
        }
    }
    catch { }
}
/**
 * Sanitizes and validates a requested filename to prevent path traversal attacks.
 */
export function validateExportFilename(filename) {
    // Disallow path traversal characters
    const basename = path.basename(filename);
    if (basename !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        throw new Error('Invalid filename specified');
    }
    // Must match standard safe filename pattern: e.g. timetable_*.xlsx or timetable_*.pdf
    if (!/^[a-zA-Z0-9_\-\.]+\.(xlsx|pdf|csv)$/i.test(basename)) {
        throw new Error('Filename contains disallowed characters or unsupported extension');
    }
    return basename;
}
/**
 * Returns the full path to a validated export file, verifying existence.
 */
export function getExportFilePath(filename) {
    const safeFilename = validateExportFilename(filename);
    const fullPath = path.join(EXPORTS_DIR, safeFilename);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${safeFilename}`);
    }
    return fullPath;
}
