import { Router } from 'express';
import { createLeave, listLeave, getLeave, deleteLeave, } from '../services/leaveService.js';
export const leaveRouter = Router();
// GET /api/leave
leaveRouter.get('/', (_req, res, next) => {
    try {
        const leave = listLeave();
        res.json({ leave });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/leave/:id
leaveRouter.get('/:id', (req, res, next) => {
    try {
        const item = getLeave(req.params.id);
        if (!item) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Leave record "${req.params.id}" not found` },
            });
        }
        res.json({ leave: item });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/leave
leaveRouter.post('/', (req, res, next) => {
    try {
        const leave = createLeave(req.body);
        res.status(201).json({
            success: true,
            leave,
            message: 'Leave application recorded successfully',
        });
    }
    catch (err) {
        if (err.message && (err.message.includes('Staff') ||
            err.message.includes('staff_id') ||
            err.message.includes('semester') ||
            err.message.includes('date') ||
            err.message.includes('required'))) {
            return res.status(400).json({
                error: {
                    code: 'BAD_REQUEST',
                    message: err.message,
                },
            });
        }
        next(err);
    }
});
// DELETE /api/leave/:id
leaveRouter.delete('/:id', (req, res, next) => {
    try {
        const deleted = deleteLeave(req.params.id);
        if (!deleted) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Leave record "${req.params.id}" not found` },
            });
        }
        res.json({ success: true, message: 'Leave record deleted successfully' });
    }
    catch (err) {
        next(err);
    }
});
