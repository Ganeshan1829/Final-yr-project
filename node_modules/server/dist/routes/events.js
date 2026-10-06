import { Router } from 'express';
import { createEvent, listEvents, getEvent, deleteEvent, } from '../services/eventsService.js';
export const eventsRouter = Router();
// GET /api/events
eventsRouter.get('/', (_req, res, next) => {
    try {
        const events = listEvents();
        res.json({ events });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/events/:id
eventsRouter.get('/:id', (req, res, next) => {
    try {
        const event = getEvent(req.params.id);
        if (!event) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Event with id "${req.params.id}" not found` },
            });
        }
        res.json({ event });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/events
eventsRouter.post('/', (req, res, next) => {
    try {
        const event = createEvent(req.body);
        res.status(201).json({
            success: true,
            event,
            message: 'Event scheduled successfully',
        });
    }
    catch (err) {
        // If validation failed or 400
        if (err.message && (err.message.includes('venue_room_id') ||
            err.message.includes('Venue') ||
            err.message.includes('Staff') ||
            err.message.includes('semester') ||
            err.message.includes('period') ||
            err.message.includes('Cannot') ||
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
// DELETE /api/events/:id
eventsRouter.delete('/:id', (req, res, next) => {
    try {
        const deleted = deleteEvent(req.params.id);
        if (!deleted) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Event with id "${req.params.id}" not found` },
            });
        }
        res.json({ success: true, message: 'Event deleted successfully' });
    }
    catch (err) {
        next(err);
    }
});
