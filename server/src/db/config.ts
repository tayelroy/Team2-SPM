import dotenv from 'dotenv';
dotenv.config();

export interface DatabaseConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
}

export const dbConfig: DatabaseConfig = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  databaseUrl: process.env.DATABASE_URL
};

export function isSupabaseConfigured(): boolean {
  return Boolean(dbConfig.supabaseUrl && (dbConfig.supabaseAnonKey || dbConfig.supabaseServiceRoleKey));
}

export function isPostgresConfigured(): boolean {
  return Boolean(dbConfig.databaseUrl);
}
