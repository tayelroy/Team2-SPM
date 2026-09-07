import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import { isSupabaseConfigured } from './db';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(
    `Supabase HTTPS client [${isSupabaseConfigured() ? 'CONFIGURED' : 'UNCONFIGURED'}]`
  );
});
