import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { schemasRouter } from './routes/schemas.js';
import { datasetsRouter } from './routes/datasets.js';
import { rulesRouter } from './routes/rules.js';
import { holidaysRouter } from './routes/holidays.js';
import { sampleRouter } from './routes/sample.js';
import { readinessRouter } from './routes/readiness.js';
import { eventsRouter } from './routes/events.js';
import { leaveRouter } from './routes/leave.js';
import { etlRouter } from './routes/etl.js';
import { cleanRouter } from './routes/clean.js';
import { forecastProxyRouter } from './routes/forecastProxy.js';
import { engineRouter } from './routes/engine.js';
import { changesRouter } from './routes/changes.js';
import { chatbotRouter } from './routes/chatbot.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportRouter } from './routes/export.js';
import { errorHandler } from './middleware/errorHandler.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
});

export const app = express();
const PORT = process.env.PORT || 4000;

// Security and utility middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:4000',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman) or matching origin
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  })
);

// Proxy /api/forecast to FastAPI ML Service on port 8000
app.use('/api/forecast', forecastProxyRouter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Pino request logging (skip logging during test runs if desired)
if (process.env.NODE_ENV !== 'test') {
  app.use(pinoHttp({ logger }));
}

// API Routes
app.use('/api/schemas', schemasRouter);
app.use('/api/datasets', datasetsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/sample', sampleRouter);
app.use('/api/readiness', readinessRouter);
app.use('/api/events', eventsRouter);
app.use('/api/leave', leaveRouter);
app.use('/api/etl', etlRouter);
app.use('/api/clean', cleanRouter);
app.use('/api/engine', engineRouter);
app.use('/api/changes', changesRouter);
app.use('/api/chat', chatbotRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/export', exportRouter);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'healthy', module: 1, service: 'Inputs and Upload' });
});

// JSON 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    },
  });
});

// Central error handler
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}
