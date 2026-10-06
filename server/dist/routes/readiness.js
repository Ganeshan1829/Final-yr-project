import { Router } from 'express';
import { getReadiness } from '../services/readinessService.js';
export const readinessRouter = Router();
// GET /api/readiness
readinessRouter.get('/', (_req, res, next) => {
    try {
        const readiness = getReadiness();
        res.json(readiness);
    }
    catch (err) {
        next(err);
    }
});
