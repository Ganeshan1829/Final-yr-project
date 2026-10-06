import { Router } from 'express';
import { DATASET_SCHEMAS, RULES_CSV_COLUMNS } from '../schemas/datasets.js';
export const schemasRouter = Router();
schemasRouter.get('/', (_req, res) => {
    res.json({
        datasets: DATASET_SCHEMAS,
        rulesColumns: RULES_CSV_COLUMNS,
    });
});
