import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { isSupabaseConfigured, isPostgresConfigured } from './db';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(
    `Database status: Supabase Client [${isSupabaseConfigured() ? 'CONFIGURED' : 'UNCONFIGURED'}], Postgres Pool [${isPostgresConfigured() ? 'CONFIGURED' : 'UNCONFIGURED'}]`
  );
});
