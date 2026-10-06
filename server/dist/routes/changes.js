import { Router } from 'express';
import { previewChange, confirmChange, discardChange, revertChange, getChanges, getChangeById, getChangeHistory, getManagementAlerts, } from '../services/changes/changesService.js';
export const changesRouter = Router();
/**
 * POST /api/changes/preview
 * Previews a management change without modifying live calendar/timetable.
 */
changesRouter.post('/preview', (req, res) => {
    try {
        const { type, payload, created_by, is_what_if } = req.body;
        if (!type || !payload) {
            return res.status(400).json({ error: 'Missing required fields: type and payload.' });
        }
        if (!['leave', 'event', 'intake'].includes(type)) {
            return res.status(400).json({ error: `Invalid change type '${type}'. Must be 'leave', 'event', or 'intake'.` });
        }
        const user = req.headers['x-user-role'] || created_by || 'HOD';
        const preview = previewChange(type, payload, user, Boolean(is_what_if));
        return res.json(preview);
    }
    catch (err) {
        return res.status(400).json({ error: 'Failed to preview change', message: err.message });
    }
});
/**
 * GET /api/changes/alerts
 * Returns active schedule alerts (unresolved items & shortfall counts).
 */
changesRouter.get('/alerts', (_req, res) => {
    try {
        const alerts = getManagementAlerts();
        return res.json(alerts);
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to fetch alerts', message: err.message });
    }
});
/**
 * GET /api/changes
 * Returns list of changes with optional filtering.
 */
changesRouter.get('/', (req, res) => {
    try {
        const status = req.query.status;
        const type = req.query.type;
        const changes = getChanges({ status, type });
        return res.json({ count: changes.length, changes });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to fetch changes', message: err.message });
    }
});
/**
 * GET /api/changes/history
 * Returns overall change audit trail.
 */
changesRouter.get('/history', (_req, res) => {
    try {
        const history = getChangeHistory();
        return res.json({ count: history.length, history });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to fetch history', message: err.message });
    }
});
/**
 * GET /api/changes/:id
 * Returns single change with parsed impact summary.
 */
changesRouter.get('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const change = getChangeById(id);
        if (!change) {
            return res.status(404).json({ error: `Change ID ${id} not found.` });
        }
        return res.json(change);
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to fetch change', message: err.message });
    }
});
/**
 * POST /api/changes/:id/confirm
 * Atomically confirms and applies a previewed change.
 */
changesRouter.post('/:id/confirm', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const user = req.headers['x-user-role'] || req.body?.confirmed_by || 'HOD';
        // Role check: only HOD can confirm
        if (user.toLowerCase() === 'student' || user.toLowerCase() === 'staff') {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Role '${user}' is not authorized to confirm schedule changes. HOD role required.`,
            });
        }
        const result = confirmChange(id, user);
        return res.json(result);
    }
    catch (err) {
        const isConflict = err.message && err.message.includes('stale');
        return res.status(isConflict ? 409 : 400).json({
            error: 'Failed to confirm change',
            message: err.message,
        });
    }
});
/**
 * POST /api/changes/:id/discard
 * Discards a previewed change.
 */
changesRouter.post('/:id/discard', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = discardChange(id);
        return res.json(result);
    }
    catch (err) {
        return res.status(400).json({ error: 'Failed to discard change', message: err.message });
    }
});
/**
 * POST /api/changes/:id/revert
 * Reverts an applied change, restoring exact previous state.
 */
changesRouter.post('/:id/revert', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const user = req.headers['x-user-role'] || req.body?.reverted_by || 'HOD';
        if (user.toLowerCase() === 'student' || user.toLowerCase() === 'staff') {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Role '${user}' is not authorized to revert schedule changes. HOD role required.`,
            });
        }
        const result = revertChange(id, user);
        return res.json(result);
    }
    catch (err) {
        return res.status(400).json({ error: 'Failed to revert change', message: err.message });
    }
});
/**
 * GET /api/changes/:id/history
 * Returns change log history for a specific change.
 */
changesRouter.get('/:id/history', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const history = getChangeHistory(id);
        return res.json({ count: history.length, history });
    }
    catch (err) {
        return res.status(500).json({ error: 'Failed to fetch change history', message: err.message });
    }
});
