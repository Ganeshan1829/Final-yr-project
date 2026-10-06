import { Router } from 'express';
import Papa from 'papaparse';
import {
  checkRequiredDatasets,
  executeEtlPipeline,
} from '../etl/runner.js';
import { getAllRules } from '../etl/registry.js';
import {
  getEtlRuns,
  getEtlRunById,
  getLatestEtlRun,
  getEtlIssues,
  getAllIssuesForRun,
  getRunSummary,
} from '../db/repositories/etlRepository.js';

export const etlRouter = Router();

// POST /api/etl/run
etlRouter.post('/run', (_req, res, next) => {
  try {
    const check = checkRequiredDatasets();
    if (!check.ready) {
      return res.status(409).json({
        error: {
          code: 'DATASETS_MISSING',
          message: `Cannot run validation: required datasets missing: ${check.missing.join(', ')}`,
          details: { missing: check.missing },
        },
      });
    }

    const result = executeEtlPipeline();
    res.json(result);
  } catch (err: any) {
    if (err.code === 'DATASETS_MISSING') {
      return res.status(409).json({
        error: {
          code: 'DATASETS_MISSING',
          message: err.message,
          details: { missing: err.missing },
        },
      });
    }
    next(err);
  }
});

// GET /api/etl/runs
etlRouter.get('/runs', (_req, res) => {
  const runs = getEtlRuns();
  res.json({ runs });
});

// GET /api/etl/latest
etlRouter.get('/latest', (_req, res) => {
  const run = getLatestEtlRun();
  const summary = run ? getRunSummary(run.id) : null;
  res.json({ run, summary });
});

// GET /api/etl/rules
etlRouter.get('/rules', (_req, res) => {
  const rules = getAllRules().map((r) => ({
    code: r.code,
    dataset: r.dataset,
    severity: r.severity,
    description: r.description,
  }));
  res.json({ rules });
});

// GET /api/etl/runs/:id
etlRouter.get('/runs/:id', (req, res) => {
  const runId = Number(req.params.id);
  if (isNaN(runId)) {
    return res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Run ID must be an integer' },
    });
  }

  const run = getEtlRunById(runId);
  if (!run) {
    return res.status(404).json({
      error: { code: 'RUN_NOT_FOUND', message: `ETL run with id ${runId} not found` },
    });
  }

  const summary = getRunSummary(runId);
  res.json({ run, summary });
});

// GET /api/etl/runs/:id/issues
etlRouter.get('/runs/:id/issues', (req, res) => {
  const runId = Number(req.params.id);
  if (isNaN(runId)) {
    return res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Run ID must be an integer' },
    });
  }

  const { severity, dataset, rule, q, page, pageSize } = req.query;

  const result = getEtlIssues(runId, {
    severity: typeof severity === 'string' ? severity : undefined,
    dataset: typeof dataset === 'string' ? dataset : undefined,
    rule: typeof rule === 'string' ? rule : undefined,
    q: typeof q === 'string' ? q : undefined,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 50,
  });

  res.json({
    runId,
    ...result,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 50,
  });
});

// GET /api/etl/runs/:id/issues.csv
etlRouter.get('/runs/:id/issues.csv', (req, res) => {
  const runId = Number(req.params.id);
  if (isNaN(runId)) {
    return res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Run ID must be an integer' },
    });
  }

  const issues = getAllIssuesForRun(runId);
  const csvData = issues.map((i) => ({
    rule_code: i.rule_code,
    dataset: i.dataset,
    row_number: i.row_number,
    column: i.column_name || '',
    severity: i.severity,
    action_taken: i.action_taken || '',
    original_value: i.original_value || '',
    new_value: i.new_value || '',
    message: i.message,
  }));

  const csv = Papa.unparse(csvData, { quotes: true, header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="etl_issues_run_${runId}.csv"`);
  res.send(csv);
});
