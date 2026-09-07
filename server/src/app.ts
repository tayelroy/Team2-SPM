import express, { Request, Response } from 'express';
import cors from 'cors';
import { checkDatabaseHealth, isSupabaseConfigured, isPostgresConfigured } from './db';

export const app = express();

app.use(cors());
app.use(express.json());

// Base health check endpoint (satisfies Acceptance Criterion 2)
app.get(['/health', '/api/health'], (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'ConnectSphere Backend',
    database: {
      provider: 'Supabase Postgres',
      configured: isSupabaseConfigured() || isPostgresConfigured(),
      supabaseClient: isSupabaseConfigured() ? 'configured' : 'unconfigured',
      postgresPool: isPostgresConfigured() ? 'configured' : 'unconfigured'
    }
  });
});

// Database health check endpoint
app.get(['/health/db', '/api/health/db'], async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseHealth();
  const hasError =
    dbHealth.configured &&
    (dbHealth.supabase.status === 'error' || dbHealth.postgres.status === 'error');

  res.status(hasError ? 503 : 200).json({
    status: hasError ? 'degraded' : 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    service: 'ConnectSphere Backend',
    database: dbHealth
  });
});
