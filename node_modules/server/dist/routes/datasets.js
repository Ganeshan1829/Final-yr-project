import { Router } from 'express';
import multer from 'multer';
import { getAllDatasetsStatus, processAndSaveUpload, getDatasetPreview, generateTemplateCsv, deleteDataset, } from '../services/uploadService.js';
import { DATASET_SCHEMAS } from '../schemas/datasets.js';
export const datasetsRouter = Router();
// Configure multer in-memory storage (up to 10 MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
        const ext = file.originalname.toLowerCase().split('.').pop();
        if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only CSV and XLSX files are accepted.'));
        }
    },
});
// GET /api/datasets
datasetsRouter.get('/', (_req, res, next) => {
    try {
        const datasets = getAllDatasetsStatus();
        res.json({ datasets });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/datasets/:name/upload
datasetsRouter.post('/:name/upload', upload.single('file'), (req, res, next) => {
    try {
        const datasetName = req.params.name;
        if (!DATASET_SCHEMAS[datasetName]) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Unknown dataset: ${datasetName}` },
            });
        }
        if (!req.file) {
            return res.status(400).json({
                error: { code: 'FILE_MISSING', message: 'No file uploaded' },
            });
        }
        if (req.file.size === 0) {
            return res.status(400).json({
                error: { code: 'FILE_EMPTY', message: 'Uploaded file is empty' },
            });
        }
        const { record, report } = processAndSaveUpload(datasetName, req.file.originalname, req.file.buffer);
        res.json({
            success: true,
            dataset: datasetName,
            status: record.status,
            rowCount: record.row_count,
            report,
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/datasets/:name/preview
datasetsRouter.get('/:name/preview', (req, res, next) => {
    try {
        const datasetName = req.params.name;
        const limit = Math.min(Number(req.query.limit) || 25, 100);
        const preview = getDatasetPreview(datasetName, limit);
        if (!preview) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Dataset "${datasetName}" has not been uploaded yet` },
            });
        }
        res.json(preview);
    }
    catch (err) {
        next(err);
    }
});
// GET /api/datasets/:name/template
datasetsRouter.get('/:name/template', (req, res, next) => {
    try {
        const datasetName = req.params.name;
        if (!DATASET_SCHEMAS[datasetName]) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Unknown dataset: ${datasetName}` },
            });
        }
        const csv = generateTemplateCsv(datasetName);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${datasetName}_template.csv"`);
        res.send(csv);
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/datasets/:name
datasetsRouter.delete('/:name', (req, res, next) => {
    try {
        const datasetName = req.params.name;
        const deleted = deleteDataset(datasetName);
        if (!deleted) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: `Dataset "${datasetName}" was not found or already deleted` },
            });
        }
        res.json({ success: true, message: `Dataset ${datasetName} removed successfully` });
    }
    catch (err) {
        next(err);
    }
});
