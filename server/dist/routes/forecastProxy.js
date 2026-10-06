import { Router } from 'express';
import http from 'node:http';
export const forecastProxyRouter = Router();
const ML_PORT = Number(process.env.ML_PORT) || 8000;
forecastProxyRouter.all('*', (req, res) => {
    const options = {
        hostname: '127.0.0.1',
        port: ML_PORT,
        path: req.originalUrl,
        method: req.method,
        headers: {
            ...req.headers,
            host: `127.0.0.1:${ML_PORT}`,
        },
    };
    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (_err) => {
        res.status(503).json({
            error: {
                code: 'ML_SERVICE_OFFLINE',
                message: `Demand Forecast ML service offline on port ${ML_PORT}. Please ensure uvicorn backend.ml.main:app --port 8000 is running.`,
            },
        });
    });
    req.pipe(proxyReq);
});
